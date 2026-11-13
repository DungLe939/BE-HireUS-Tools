import { cvTechnologyTerms, guardedTranscript, refineConfiguration, withRefineDeadline } from './utils/transcript-refine.util';
import { STT_PROVIDER, MAX_AUDIO_BYTES, STT_MIME } from './interfaces/stt-provider.interface';
import type { SttAudio, SttProvider } from './interfaces/stt-provider.interface';
import { randomUUID } from 'node:crypto';
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  GatewayTimeoutException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  Optional,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { TTS_PROVIDER } from './interfaces/tts-provider.interface';
import type { TtsProvider } from './interfaces/tts-provider.interface';
import { AI_PROVIDER } from './interfaces/ai-provider.interface';
import type { AiProvider } from './interfaces/ai-provider.interface';
import { CV_PROVIDER } from './interfaces/cv-provider.interface';
import type { CvProvider } from './interfaces/cv-provider.interface';
import { VMI_SESSION_REPOSITORY } from './interfaces/vmi-session-repository.interface';
import type { VmiSessionRepository } from './interfaces/vmi-session-repository.interface';
import type { CreateVmiSessionDto } from './dto/create-vmi-session.dto';
import type { StartVmiSessionDto } from './dto/start-vmi-session.dto';
import type { ListVmiSessionsQueryDto } from './dto/list-vmi-sessions-query.dto';
import { VmiLanguage, VmiLevel, VmiPosition, VmiSessionStatus, VmiStage } from './types/vmi.types';
import type { InitInterviewContextOutput, VmiSession, VmiTurn, GenerateNextQuestionInput, VmiPlannedQuestion, VmiReport } from './types/vmi.types';

import { calculateVmiScore } from './utils/vmi-scoring.util';

@Injectable()
export class VmiService {
  private readonly transcribingSessions = new Set<string>();

  async transcribeAudio(userId: string, id: string, audio: SttAudio | undefined) {
    const session = await this.ownedSession(userId, id);
    const question = session.turns.at(-1);
    if (session.status !== VmiSessionStatus.IN_PROGRESS || session.pendingNextQuestion || !question ||
      question.answerText !== undefined || this.transcribingSessions.has(id)) throw new BadRequestException('Session is not ready for transcription.');
    const rawLimit = process.env.VMI_AUDIO_MAX_BYTES ?? String(MAX_AUDIO_BYTES);
    const limit = Number(rawLimit);
    if (!/^\d+$/.test(rawLimit) || !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_AUDIO_BYTES) {
      throw new ServiceUnavailableException({ statusCode: 503, error: 'Service Unavailable', code: 'VMI_STT_UNAVAILABLE', message: 'Speech recognition is unavailable.' });
    }
    if (!audio || !Buffer.isBuffer(audio.buffer) || audio.buffer.length === 0) throw new BadRequestException('Provide one nonempty audio file.');
    if (audio.size > limit || audio.buffer.length > limit) throw new PayloadTooLargeException('Audio exceeds the upload limit.');
    if (!STT_MIME.test(audio.mimetype)) throw new UnsupportedMediaTypeException({ statusCode: 415, error: 'Unsupported Media Type',
      code: 'VMI_STT_UNSUPPORTED_AUDIO', message: 'Unsupported audio format.' });
    this.transcribingSessions.add(id);
    try {
      const result = await this.measureSpeech('stt', async () => {
        if (!this.stt) throw new ServiceUnavailableException();
        return this.stt.transcribe(audio, session.language);
      });
      let text = result.text;
      if (process.env.VMI_STT_REFINE_ENABLED === 'true' && result.text.trim() && result.text.length <= 20000) {
        const began = performance.now();
        try {
          const candidate = await withRefineDeadline(() => this.ai.refineTranscript({
            rawText: result.text, question: question.questionText, position: session.position, level: session.level,
            language: session.language, cvTerms: session.cvSnapshot ? cvTechnologyTerms(session.cvSnapshot.summary) : [],
          }), refineConfiguration().timeoutMs);
          text = guardedTranscript(result.text, candidate);
        } catch { text = result.text; }
        finally { this.logger.log({ event: 'stt_refine', durationMs: Number((performance.now() - began).toFixed(3)) }); }
      }
      return { text, language: session.language, rawText: result.text, refined: text !== result.text };
    } finally { this.transcribingSessions.delete(id); }
  }

  private readonly synthesizingQuestions = new Map<string, Promise<Buffer>>();

  async synthesizeQuestion(userId: string, id: string, questionId: string): Promise<Buffer> {
    const session = await this.ownedSession(userId, id);
    if (![VmiSessionStatus.SETUP, VmiSessionStatus.IN_PROGRESS].includes(session.status)) {
      throw new BadRequestException('Question playback requires SETUP or IN_PROGRESS.');
    }
    const question = session.turns.find(turn => turn.questionId === questionId);
    if (!question) throw new NotFoundException('Question not found.');
    const key = `${id}:${questionId}`;
    const pending = this.synthesizingQuestions.get(key);
    if (pending) return pending;
    const generation = this.measureSpeech('tts', async () => {
      if (!this.tts) throw new ServiceUnavailableException();
      return this.tts.synthesize(question.questionText, session.language);
    });
    this.synthesizingQuestions.set(key, generation);
    try { return await generation; }
    finally { this.synthesizingQuestions.delete(key); }
  }

  private async measureSpeech<T>(event: 'stt' | 'tts', operation: () => Promise<T>): Promise<T> {
    const began = performance.now();
    try { return await operation(); }
    catch (error: unknown) {
      const upstream = error instanceof HttpException ? error.getStatus() : 502;
      if (event === 'stt' && error instanceof HttpException) {
        const response = error.getResponse();
        const code = typeof response === 'object' && response !== null ? (response as { code?: unknown }).code : undefined;
        if (upstream === 413) throw new PayloadTooLargeException('Audio exceeds the upload limit.');
        if (upstream === 415) throw new UnsupportedMediaTypeException({ statusCode: 415, error: 'Unsupported Media Type', code: 'VMI_STT_UNSUPPORTED_AUDIO', message: 'Unsupported or invalid audio.' });
        if (upstream === 422 && (code === 'VMI_STT_AUDIO_TOO_LONG' || code === 'VMI_STT_EMPTY_TRANSCRIPT')) {
          throw new UnprocessableEntityException({ statusCode: 422, error: 'Unprocessable Entity', code, message: 'Recording is too long or no speech was recognized. Record again or type your answer.' });
        }
      }
      const statusCode = upstream === 504 ? 504 : upstream === 503 || upstream === 429 ? 503 : 502;
      const body = { statusCode, error: statusCode === 504 ? 'Gateway Timeout' : statusCode === 503 ? 'Service Unavailable' : 'Bad Gateway',
        code: `VMI_${event.toUpperCase()}_${statusCode === 504 ? 'TIMEOUT' : 'UNAVAILABLE'}`,
        message: 'Speech processing failed. Retry or continue using text.' };
      throw statusCode === 504 ? new GatewayTimeoutException(body) : statusCode === 503 ? new ServiceUnavailableException(body) : new BadGatewayException(body);
    }
    finally { this.logger.log({ event, durationMs: Number((performance.now() - began).toFixed(3)) }); }
  }

  async listSessions(userId: string, query: ListVmiSessionsQueryDto) {
    const { limit, offset } = query;
    const page = await this.repository.findManyByUserId(userId, { limit, offset });
    return {
      items: page.items.map(session => ({
        id: session.id, createdAt: session.createdAt,
        position: session.position, level: session.level, language: session.language, status: session.status,
        ...(session.report ? { overallScore: this.serializeReport(session.report).overallScore, band: session.report.band } : {}),
      })),
      total: page.total, limit, offset,
    };
  }

  async getSessionDetails(userId: string, id: string) {
    const session = await this.ownedSession(userId, id);
    return {
      id: session.id, position: session.position, level: session.level, language: session.language,
      status: session.status, targetQuestionCount: session.targetQuestionCount,
      ...(session.cvId !== undefined ? { cvId: session.cvId } : {}),
      ...(session.cvSnapshot ? { cvSnapshot: { id: session.cvSnapshot.id, summary: session.cvSnapshot.summary } } : {}),
      createdAt: session.createdAt, updatedAt: session.updatedAt,
      ...(session.startedAt ? { startedAt: session.startedAt } : {}),
      ...(session.endedAt ? { endedAt: session.endedAt } : {}),
      transcript: this.serializeTranscript(session),
      ...(session.report ? { report: this.serializeReport(session.report) } : {}),
    };
  }
  async retryNextQuestion(userId: string, id: string) {
    const prepared = await this.mutateSession(userId, id, async session => {
      if (session.status !== VmiSessionStatus.IN_PROGRESS || !session.pendingNextQuestion || this.generatingSessions.has(id)) {
        throw new ConflictException('Session is not ready to retry the next question.');
      }
      const lastTurn = session.turns.at(-1);
      if (!lastTurn || session.turns.some(turn => !turn.answerText?.trim()) || session.turns.length > session.targetQuestionCount) {
        throw new ConflictException('Saved answers are not ready for next-question recovery.');
      }
      if (session.turns.length === session.targetQuestionCount) {
        session.status = VmiSessionStatus.ENDED;
        session.pendingNextQuestion = false;
        delete session.lastAiError;
        session.endedAt = new Date(Date.now());
        session.updatedAt = session.endedAt;
        await this.repository.save(session);
      } else {
        this.generatingSessions.add(id);
      }
      return { session, acceptedAnswer: {
        questionId: lastTurn.questionId, elapsedSeconds: lastTurn.elapsedSeconds ?? 0, timedOut: lastTurn.timedOut ?? false,
      } };
    });
    if (prepared.session.status === VmiSessionStatus.ENDED) return this.answerResult(prepared.session, prepared.acceptedAnswer);
    return this.generateAndStoreNextQuestion(userId, id, prepared);
  }

  async retryReport(userId: string, id: string) {
    return this.evaluateStoredSession(userId, id, VmiSessionStatus.REPORT_FAILED);
  }
  private readonly evaluatingSessions = new Set<string>();

  async evaluateSession(userId: string, id: string) {
    return this.evaluateStoredSession(userId, id, VmiSessionStatus.ENDED);
  }

  private async evaluateStoredSession(userId: string, id: string,
    requiredStatus: VmiSessionStatus.ENDED | VmiSessionStatus.REPORT_FAILED) {
    const session = await this.mutateSession(userId, id, async current => {
      if (current.status !== requiredStatus || this.evaluatingSessions.has(id) ||
        (requiredStatus === VmiSessionStatus.REPORT_FAILED && this.generatingSessions.has(id))) {
        throw new ConflictException('Session is not ready for evaluation.');
      }
      if (!current.turns.some(turn => turn.answerText?.trim())) {
        throw new UnprocessableEntityException('Not enough interview data to evaluate.');
      }
      this.evaluatingSessions.add(id);
      return current;
    });
    try {
      const assessment = await this.ai.evaluateInterview({
        position: session.position, level: session.level, language: session.language,
        targetQuestionCount: session.targetQuestionCount, cvSnapshot: structuredClone(session.cvSnapshot),
        context: session.context!, questionPlan: structuredClone(session.questionPlan!), transcript: structuredClone(session.turns),
      });
      const calculated = calculateVmiScore(assessment, session.language);
      const report: VmiReport = {
        technical: assessment.technical, problemSolving: assessment.problemSolving, communication: assessment.communication,
        overallScore: calculated.rawScore, band: calculated.band,
        strengths: structuredClone(assessment.strengths), knowledgeGaps: structuredClone(assessment.knowledgeGaps),
        suggestedAnswers: structuredClone(assessment.suggestedAnswers), reviewTopics: structuredClone(assessment.reviewTopics),
        recommendation: calculated.recommendation, disclaimer: calculated.disclaimer, createdAt: new Date(Date.now()),
      };
      return await this.mutateSession(userId, id, async current => {
        current.report = report;
        current.status = VmiSessionStatus.EVALUATED;
        current.updatedAt = report.createdAt;
        delete current.lastAiError;
        await this.repository.save(current);
        return this.reportResult(current);
      });
    } catch (error: unknown) {
      const failure = this.operationAiError(error, 'REPORT');
      await this.mutateSession(userId, id, async current => {
        current.status = VmiSessionStatus.REPORT_FAILED;
        current.lastAiError = (failure.getResponse() as { code: string }).code;
        current.updatedAt = new Date(Date.now());
        await this.repository.save(current);
      });
      throw failure;
    } finally {
      this.evaluatingSessions.delete(id);
    }
  }

  async getReport(userId: string, id: string) {
    const session = await this.ownedSession(userId, id);
    if (session.status !== VmiSessionStatus.EVALUATED || !session.report) throw new NotFoundException('Report not found.');
    return this.reportResult(session);
  }

  private reportResult(session: VmiSession) {
    return {
      id: session.id, status: VmiSessionStatus.EVALUATED, language: session.language,
      transcript: this.serializeTranscript(session), report: this.serializeReport(session.report!),
    };
  }

  private serializeTranscript(session: VmiSession) {
    return session.turns.map(turn => ({
      questionId: turn.questionId, questionText: turn.questionText, stage: turn.stage, askedAt: turn.askedAt,
      ...(turn.answerText !== undefined ? { answerText: turn.answerText, answeredAt: turn.answeredAt,
        elapsedSeconds: turn.elapsedSeconds, timedOut: turn.timedOut } : {}),
    }));
  }

  private serializeReport(report: VmiReport) {
    return {
      technical: report.technical, problemSolving: report.problemSolving, communication: report.communication,
      overallScore: Number(report.overallScore.toFixed(2)), band: report.band,
      strengths: report.strengths, knowledgeGaps: report.knowledgeGaps,
      suggestedAnswers: report.suggestedAnswers, reviewTopics: report.reviewTopics,
      recommendation: report.recommendation, disclaimer: report.disclaimer, createdAt: report.createdAt,
    };
  }

  private readonly logger = new Logger(VmiService.name);
  private readonly mutations = new Map<string, Promise<void>>();
  private readonly generatingSessions = new Set<string>();

  async submitAnswer(userId: string, id: string, input: { questionId: string; answerText: string }) {
    const prepared = await this.mutateSession(userId, id, async session => {
      if (session.status !== VmiSessionStatus.IN_PROGRESS || session.pendingNextQuestion) {
        throw new ConflictException('Session is not ready for an answer.');
      }
      const turn = session.turns.at(-1);
      if (!turn || turn.questionId !== input.questionId || turn.answerText !== undefined || !turn.askedAt) {
        throw new ConflictException('Question is not awaiting an answer.');
      }
      const now = new Date(Date.now());
      turn.answerText = input.answerText;
      turn.answeredAt = now;
      turn.elapsedSeconds = Math.max(0, (now.getTime() - turn.askedAt.getTime()) / 1000);
      turn.timedOut = turn.elapsedSeconds > 180;
      session.updatedAt = now;
      if (session.turns.length === session.targetQuestionCount) {
        session.status = VmiSessionStatus.ENDED;
        session.endedAt = now;
        session.pendingNextQuestion = false;
      } else {
        session.pendingNextQuestion = true;
      }
      await this.repository.save(session);
      if (session.pendingNextQuestion) this.generatingSessions.add(id);
      return { session, acceptedAnswer: {
        questionId: turn.questionId, elapsedSeconds: turn.elapsedSeconds, timedOut: turn.timedOut,
      } };
    });
    if (prepared.session.status === VmiSessionStatus.ENDED) {
      return this.answerResult(prepared.session, prepared.acceptedAnswer);
    }

    return this.generateAndStoreNextQuestion(userId, id, prepared);
  }

  private async generateAndStoreNextQuestion(userId: string, id: string, prepared: {
    session: VmiSession;
    acceptedAnswer: { questionId: string; elapsedSeconds: number; timedOut: boolean };
  }) {
    try {
      let generated: VmiPlannedQuestion;
      const generationInput = this.nextQuestionInput(prepared.session);
      const began = performance.now();
      try {
        generated = await this.ai.generateNextQuestion(generationInput);
        if (generated.stage !== generationInput.stage || !generated.questionText?.trim() ||
          typeof generated.cvBased !== 'boolean' || (generationInput.requireCvBased && !generated.cvBased) ||
          (!prepared.session.cvSnapshot && generated.cvBased)) {
          throw new BadGatewayException();
        }
      } catch (error: unknown) {
        const failure = this.operationAiError(error, 'NEXT_QUESTION');
        const ended = await this.mutateSession(userId, id, async session => {
          if (session.status !== VmiSessionStatus.IN_PROGRESS) return true;
          session.lastAiError = (failure.getResponse() as { code: string }).code;
          session.updatedAt = new Date(Date.now());
          await this.repository.save(session);
          return false;
        });
        if (ended) return this.answerResult({ status: VmiSessionStatus.ENDED, id }, prepared.acceptedAnswer);
        throw failure;
      } finally {
        this.logger.log({ event: 'generateNextQuestion', durationMs: Number((performance.now() - began).toFixed(3)) });
      }
      return await this.mutateSession(userId, id, async session => {
        if (session.status !== VmiSessionStatus.IN_PROGRESS) return this.answerResult(session, prepared.acceptedAnswer);
        const turn: VmiTurn = {
          questionId: randomUUID(), questionText: generated.questionText, stage: generated.stage,
          cvBased: generated.cvBased, askedAt: new Date(Date.now()),
        };
        session.turns.push(turn);
        session.pendingNextQuestion = false;
        delete session.lastAiError;
        session.updatedAt = turn.askedAt!;
        await this.repository.save(session);
        return this.answerResult(session, prepared.acceptedAnswer, turn);
      });
    } finally {
      this.generatingSessions.delete(id);
    }
  }

  async finishSession(userId: string, id: string) {
    return this.mutateSession(userId, id, async session => {
      if (session.status !== VmiSessionStatus.IN_PROGRESS) throw new ConflictException('Session is not in progress.');
      session.status = VmiSessionStatus.ENDED;
      session.endedAt = new Date(Date.now());
      session.updatedAt = session.endedAt;
      session.pendingNextQuestion = false;
      await this.repository.save(session);
      return { id, status: session.status, completed: true, endedAt: session.endedAt };
    });
  }

  private nextQuestionInput(session: VmiSession): GenerateNextQuestionInput {
    const index = session.turns.length;
    const stage = index === session.targetQuestionCount - 1 ? VmiStage.CLOSING : VmiStage.TECHNICAL;
    const covered = session.turns.filter(t => t.stage === VmiStage.TECHNICAL && t.cvBased).length;
    const remainingAfter = Math.max(0, session.targetQuestionCount - index - 2);
    const required = Math.ceil((session.targetQuestionCount - 2) * 0.4);
    return {
      position: session.position, level: session.level, language: session.language,
      targetQuestionCount: session.targetQuestionCount, cvSnapshot: structuredClone(session.cvSnapshot),
      context: session.context!, questionPlan: structuredClone(session.questionPlan!),
      transcript: structuredClone(session.turns), nextQuestionIndex: index, stage,
      requireCvBased: !!session.cvSnapshot && stage === VmiStage.TECHNICAL &&
        (!!session.questionPlan![index].cvBased || required - covered > remainingAfter),
    };
  }

  private answerResult(session: Pick<VmiSession, 'id' | 'status'>,
    acceptedAnswer: { questionId: string; elapsedSeconds: number; timedOut: boolean }, question?: VmiTurn) {
    const completed = session.status !== VmiSessionStatus.IN_PROGRESS;
    return {
      id: session.id, status: completed ? VmiSessionStatus.ENDED : VmiSessionStatus.IN_PROGRESS,
      completed, acceptedAnswer,
      ...(question ? { question: {
        questionId: question.questionId, questionText: question.questionText, stage: question.stage, askedAt: question.askedAt,
      } } : {}),
    };
  }

  private async ownedSession(userId: string, id: string): Promise<VmiSession> {
    const session = await this.repository.findById(id);
    if (!session || session.userId !== userId) throw new NotFoundException('Session not found.');
    return session;
  }

  // Queue only short state mutations; do not hold this queue during next-question AI.
  // This allows finish to run while AI is pending and prevents stale snapshots overwriting answers.
  private async mutateSession<T>(userId: string, id: string, operation: (session: VmiSession) => Promise<T>): Promise<T> {
    const previous = this.mutations.get(id) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => { release = resolve; });
    const tail = previous.then(() => current);
    this.mutations.set(id, tail);
    await previous;
    try { return await operation(await this.ownedSession(userId, id)); }
    finally {
      release();
      if (this.mutations.get(id) === tail) this.mutations.delete(id);
    }
  }

  private operationAiError(error: unknown, operation: 'NEXT_QUESTION' | 'REPORT'): HttpException {
    const upstream = error instanceof HttpException ? error.getStatus() : 502;
    const statusCode = upstream === 504 ? 504 : upstream === 503 || upstream === 429 ? 503 : 502;
    const suffix = statusCode === 504 ? 'TIMEOUT' : statusCode === 503 ? 'UNAVAILABLE' : 'ERROR';
    const body = {
      statusCode, error: statusCode === 504 ? 'Gateway Timeout' : statusCode === 503 ? 'Service Unavailable' : 'Bad Gateway',
      code: `VMI_${operation}_${suffix}`, message: 'AI processing failed; saved interview data is preserved.',
      ...(operation === 'NEXT_QUESTION' ? { pendingNextQuestion: true } : { sessionStatus: VmiSessionStatus.REPORT_FAILED }),
    };
    return statusCode === 504 ? new GatewayTimeoutException(body) : statusCode === 503 ? new ServiceUnavailableException(body) : new BadGatewayException(body);
  }

  // Matches the single-process scope of the temporary in-memory repository.
  private readonly startingSessions = new Set<string>();

  constructor(
    @Inject(VMI_SESSION_REPOSITORY) private readonly repository: VmiSessionRepository,
    @Inject(AI_PROVIDER) private readonly ai: AiProvider,
    @Inject(CV_PROVIDER) private readonly cv: CvProvider,
    @Optional() @Inject(TTS_PROVIDER) private readonly tts?: TtsProvider,
    @Optional() @Inject(STT_PROVIDER) private readonly stt?: SttProvider,
  ) {}

  getOptions() {
    return {
      positions: Object.values(VmiPosition),
      levels: Object.values(VmiLevel),
      languages: Object.values(VmiLanguage),
      targetQuestionCount: { min: 5, max: 8, default: 6 },
    };
  }

  async createSession(userId: string, input: CreateVmiSessionDto) {
    const now = new Date();
    const session: VmiSession = {
      id: randomUUID(),
      userId,
      position: input.position,
      level: input.level,
      language: input.language,
      status: VmiSessionStatus.SETUP,
      targetQuestionCount: input.targetQuestionCount ?? 6,
      turns: [],
      pendingNextQuestion: false,
      createdAt: now,
      updatedAt: now,
    };
    if (input.cvId !== undefined) {
      const summary = await this.cv.getSummary(userId, input.cvId);
      if (summary === null) throw new NotFoundException('CV not found.');
      session.cvId = input.cvId;
      session.cvSnapshot = structuredClone(summary);
    }
    await this.repository.save(session);
    return {
      id: session.id,
      position: session.position,
      level: session.level,
      language: session.language,
      status: session.status,
      targetQuestionCount: session.targetQuestionCount,
      ...(session.cvId !== undefined ? { cvId: session.cvId } : {}),
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }

  async startSession(userId: string, id: string, input: StartVmiSessionDto) {
    if (input.deviceReady !== true) {
      throw new BadRequestException('Device readiness must be confirmed.');
    }
    const session = await this.repository.findById(id);
    if (!session || session.userId !== userId) {
      throw new NotFoundException('Session not found.');
    }
    if (session.status !== VmiSessionStatus.SETUP || this.startingSessions.has(id)) {
      throw new ConflictException('Session cannot be started in its current state.');
    }

    this.startingSessions.add(id);
    try {
      let initialized: InitInterviewContextOutput;
      try {
        initialized = await this.ai.initInterviewContext({
          position: session.position,
          level: session.level,
          language: session.language,
          targetQuestionCount: session.targetQuestionCount,
          ...(session.cvSnapshot !== undefined
            ? { cvSnapshot: structuredClone(session.cvSnapshot) }
            : {}),
        });
      } catch (error: unknown) {
        this.throwAiError(error);
      }

      // Nothing has been changed or saved before successful AI initialization.
      const now = new Date();
      const question: VmiTurn = {
        questionId: randomUUID(),
        questionText: initialized.openingQuestion.questionText,
        stage: initialized.openingQuestion.stage,
        askedAt: now,
      };
      await this.repository.save({
        ...session,
        status: VmiSessionStatus.IN_PROGRESS,
        turns: [{ ...question, cvBased: initialized.openingQuestion.cvBased }],
        context: initialized.context,
        questionPlan: structuredClone(initialized.questionPlan),
        startedAt: now,
        updatedAt: now,
      });
      return {
        id: session.id,
        status: VmiSessionStatus.IN_PROGRESS,
        startedAt: now,
        question,
      };
    } finally {
      this.startingSessions.delete(id);
    }
  }

  private throwAiError(error: unknown): never {
    const status = error instanceof HttpException ? error.getStatus() : 502;
    // Only status is reused. Provider messages, bodies and causes are never exposed.
    if (status === 504) {
      throw new GatewayTimeoutException({
        statusCode: 504,
        error: 'Gateway Timeout',
        code: 'VMI_AI_TIMEOUT',
        message: 'Interview initialization timed out. Retry starting the session.',
      });
    }
    if (status === 503 || status === 429) {
      throw new ServiceUnavailableException({
        statusCode: 503,
        error: 'Service Unavailable',
        code: 'VMI_AI_UNAVAILABLE',
        message: 'Interview AI is temporarily unavailable. Retry starting the session.',
      });
    }
    throw new BadGatewayException({
      statusCode: 502,
      error: 'Bad Gateway',
      code: 'VMI_AI_ERROR',
      message: 'Interview initialization failed. Retry starting the session.',
    });
  }
}
