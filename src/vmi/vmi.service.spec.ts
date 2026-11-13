import { BadGatewayException, GatewayTimeoutException, ServiceUnavailableException, Logger } from '@nestjs/common';
import type { AiProvider } from './interfaces/ai-provider.interface';
import type { CvProvider } from './interfaces/cv-provider.interface';
import { EmptyCvProvider } from './providers/empty-cv.provider';
import { InMemoryVmiSessionRepository } from './repositories/in-memory-vmi-session.repository';
import { VmiLanguage, VmiLevel, VmiPosition, VmiSessionStatus, VmiStage } from './types/vmi.types';
import type { InitInterviewContextOutput } from './types/vmi.types';
import { VmiService } from './vmi.service';

const setup = { position: VmiPosition.BACKEND, level: VmiLevel.INTERN, language: VmiLanguage.VI };
const opening = { stage: VmiStage.OPENING, questionText: 'Giới thiệu bản thân.', cvBased: false };
const aiResult: InitInterviewContextOutput = {
  context: 'Internal interview context',
  openingQuestion: opening,
  questionPlan: [opening, ...Array.from({ length: 4 }, () => ({
    stage: VmiStage.TECHNICAL, questionText: 'Câu hỏi kỹ thuật.', cvBased: false,
  })), { stage: VmiStage.CLOSING, questionText: 'Bạn có câu hỏi nào không?', cvBased: false }],
};

describe('VmiService', () => {
  let repository: InMemoryVmiSessionRepository;
  let ai: jest.Mocked<AiProvider>;
  let cv: jest.Mocked<CvProvider>;
  let service: VmiService;

  beforeEach(() => {
    repository = new InMemoryVmiSessionRepository();
    ai = { refineTranscript: jest.fn().mockImplementation(async input => input.rawText), initInterviewContext: jest.fn().mockResolvedValue(structuredClone(aiResult)), generateNextQuestion: jest.fn(), evaluateInterview: jest.fn() };
    cv = { getSummary: jest.fn().mockResolvedValue(null) };
    service = new VmiService(repository, ai, cv);
  });

  it('lists supported enums and 5-8 questions with a default of six', () => {
    expect(service.getOptions()).toEqual({
      positions: ['FRONTEND', 'BACKEND', 'FULLSTACK', 'MOBILE', 'AI_DATA'],
      levels: ['INTERN', 'FRESHER'], languages: ['vi', 'en'],
      targetQuestionCount: { min: 5, max: 8, default: 6 },
    });
  });

  it('creates SETUP without a CV or an AI call and hides internal data', async () => {
    const created = await service.createSession('owner', setup);
    expect(created).toMatchObject({ ...setup, status: 'SETUP', targetQuestionCount: 6 });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    const saved = await repository.findById(created.id);
    expect(saved).toMatchObject({ userId: 'owner', status: 'SETUP', turns: [] });
    expect(created).not.toHaveProperty('userId');
    expect(created).not.toHaveProperty('cvSnapshot');
    expect(created).not.toHaveProperty('context');
    expect(ai.initInterviewContext).not.toHaveBeenCalled();
    expect(cv.getSummary).not.toHaveBeenCalled();
  });

  it.each([5, 8])('preserves an explicit target count of %i', async (count) => {
    const created = await service.createSession('owner', { ...setup, targetQuestionCount: count });
    expect(created.targetQuestionCount).toBe(count);
    expect((await repository.findById(created.id))!.targetQuestionCount).toBe(count);
  });

  it('maps EmptyCvProvider null to 404 and creates no session', async () => {
    service = new VmiService(repository, ai, new EmptyCvProvider());
    const save = jest.spyOn(repository, 'save');
    await expect(service.createSession('owner', { ...setup, cvId: 'missing' })).rejects.toMatchObject({ status: 404 });
    expect(save).not.toHaveBeenCalled();
    expect(ai.initInterviewContext).not.toHaveBeenCalled();
  });

  it('takes a detached CV snapshot at creation and uses it at start', async () => {
    const original = { id: 'cv-1', summary: 'Original project summary' };
    cv.getSummary.mockResolvedValue(original);
    const created = await service.createSession('owner', { ...setup, cvId: 'cv-1', language: VmiLanguage.EN, level: VmiLevel.FRESHER });
    original.summary = 'Edited project summary';
    await service.startSession('owner', created.id, { deviceReady: true });
    expect(cv.getSummary).toHaveBeenCalledTimes(1);
    expect(cv.getSummary).toHaveBeenCalledWith('owner', 'cv-1');
    expect(ai.initInterviewContext).toHaveBeenCalledTimes(1);
    expect(ai.initInterviewContext).toHaveBeenCalledWith({
      ...setup, language: 'en', level: 'FRESHER', targetQuestionCount: 6,
      cvSnapshot: { id: 'cv-1', summary: 'Original project summary' },
    });
    expect((await repository.findById(created.id))!.cvSnapshot!.summary).toBe('Original project summary');
  });

  it('starts SETUP, records exactly one opening turn and timestamps', async () => {
    const created = await service.createSession('owner', setup);
    const result = await service.startSession('owner', created.id, { deviceReady: true });
    expect(result).toMatchObject({ id: created.id, status: 'IN_PROGRESS', question: { questionText: opening.questionText, stage: 'OPENING' } });
    const saved = (await repository.findById(created.id))!;
    expect(saved.status).toBe(VmiSessionStatus.IN_PROGRESS);
    expect(saved.turns).toHaveLength(1);
    expect(saved.startedAt).toEqual(saved.turns[0].askedAt);
    expect(saved.updatedAt).toEqual(saved.startedAt);
    expect(result.question.questionId).toBe(saved.turns[0].questionId);
    expect(result).not.toHaveProperty('context');
    expect(result).not.toHaveProperty('questionPlan');
  });

  it('rejects false device readiness without AI or state changes', async () => {
    const created = await service.createSession('owner', setup);
    const before = await repository.findById(created.id);
    await expect(service.startSession('owner', created.id, { deviceReady: false })).rejects.toMatchObject({ status: 400 });
    expect(await repository.findById(created.id)).toEqual(before);
    expect(ai.initInterviewContext).not.toHaveBeenCalled();
  });

  it('returns 404 for a foreign session and does not call AI', async () => {
    const created = await service.createSession('owner', setup);
    await expect(service.startSession('other', created.id, { deviceReady: true })).rejects.toMatchObject({ status: 404 });
    expect(ai.initInterviewContext).not.toHaveBeenCalled();
    expect((await repository.findById(created.id))!.status).toBe('SETUP');
  });

  it('returns 404 for an unknown session', async () => {
    await expect(service.startSession('owner', 'missing', { deviceReady: true })).rejects.toMatchObject({ status: 404 });
    expect(ai.initInterviewContext).not.toHaveBeenCalled();
  });

  it.each(['IN_PROGRESS', 'ENDED', 'EVALUATED', 'REPORT_FAILED'] as const)('rejects start from %s', async (status) => {
    const created = await service.createSession('owner', setup);
    const session = (await repository.findById(created.id))!;
    session.status = VmiSessionStatus[status];
    await repository.save(session);
    await expect(service.startSession('owner', created.id, { deviceReady: true })).rejects.toMatchObject({ status: 409 });
    expect(ai.initInterviewContext).not.toHaveBeenCalled();
  });

  it.each([
    [new BadGatewayException('sensitive-provider-marker'), 502, 'VMI_AI_ERROR'],
    [new ServiceUnavailableException('sensitive-provider-marker'), 503, 'VMI_AI_UNAVAILABLE'],
    [new GatewayTimeoutException('sensitive-provider-marker'), 504, 'VMI_AI_TIMEOUT'],
    [new Error('sensitive-provider-marker'), 502, 'VMI_AI_ERROR'],
  ])('preserves SETUP and its complete snapshot on AI failure, then allows retry', async (error, status, code) => {
    cv.getSummary.mockResolvedValue({ id: 'cv-1', summary: 'Saved CV summary' });
    const created = await service.createSession('owner', { ...setup, cvId: 'cv-1' });
    const before = await repository.findById(created.id);
    ai.initInterviewContext.mockRejectedValueOnce(error);
    await expect(service.startSession('owner', created.id, { deviceReady: true })).rejects.toMatchObject({
      status, response: { code, statusCode: status },
    });
    expect(await repository.findById(created.id)).toEqual(before);
    try {
      ai.initInterviewContext.mockRejectedValueOnce(error);
      await service.startSession('owner', created.id, { deviceReady: true });
    } catch (failure) {
      expect(JSON.stringify(failure)).not.toContain('sensitive-provider-marker');
    }
    await expect(service.startSession('owner', created.id, { deviceReady: true })).resolves.toMatchObject({ status: 'IN_PROGRESS' });
    expect((await repository.findById(created.id))!.turns).toHaveLength(1);
  });

  it('blocks concurrent starts while leaving SETUP untouched until AI completes', async () => {
    const created = await service.createSession('owner', setup);
    let release!: (result: InitInterviewContextOutput) => void;
    let entered!: () => void;
    const enteredAi = new Promise<void>((resolve) => { entered = resolve; });
    ai.initInterviewContext.mockImplementation(() => {
      entered();
      return new Promise((resolve) => { release = resolve; });
    });
    const first = service.startSession('owner', created.id, { deviceReady: true });
    await enteredAi;
    expect((await repository.findById(created.id))!.status).toBe('SETUP');
    await expect(service.startSession('owner', created.id, { deviceReady: true })).rejects.toMatchObject({ status: 409 });
    release(aiResult);
    await first;
    expect(ai.initInterviewContext).toHaveBeenCalledTimes(1);
    expect((await repository.findById(created.id))!.turns).toHaveLength(1);
  });

  it('repository returns null for unknown IDs and detaches saved and loaded data', async () => {
    expect(await repository.findById('missing')).toBeNull();
    const created = await service.createSession('owner', setup);
    const loaded = (await repository.findById(created.id))!;
    expect(loaded.createdAt.toISOString()).toBe(created.createdAt.toISOString());
    loaded.userId = 'changed-outside-repository';
    expect((await repository.findById(created.id))!.userId).toBe('owner');
    await repository.save(loaded);
    loaded.turns.push({ questionId: 'external', questionText: 'External', stage: VmiStage.OPENING });
    expect((await repository.findById(created.id))!.turns).toEqual([]);
  });
});


describe('VmiService text interview', () => {
  let latencyLog: jest.SpyInstance;
  let repository: InMemoryVmiSessionRepository;
  let service: VmiService;
  let ai: jest.Mocked<AiProvider>;

  beforeEach(() => {
    latencyLog = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    repository = new InMemoryVmiSessionRepository();
    ai = {
      refineTranscript: jest.fn().mockImplementation(async input => input.rawText), initInterviewContext: jest.fn().mockImplementation(async (input) => ({
        context: 'internal-context-marker', openingQuestion: opening,
        questionPlan: [opening, ...Array.from({ length: input.targetQuestionCount - 2 }, () => ({
          stage: VmiStage.TECHNICAL, questionText: 'Planned technical question', cvBased: false,
        })), { stage: VmiStage.CLOSING, questionText: 'Closing', cvBased: false }],
      })),
      evaluateInterview: jest.fn(),
      generateNextQuestion: jest.fn().mockImplementation(async (input) => ({
        stage: input.stage, questionText: 'Adaptive follow-up', cvBased: input.requireCvBased,
      })),
    };
    service = new VmiService(repository, ai, new EmptyCvProvider());
  });

  afterEach(() => jest.restoreAllMocks());

  async function started(count = 5) {
    const created = await service.createSession('owner', { ...setup, targetQuestionCount: count });
    return service.startSession('owner', created.id, { deviceReady: true });
  }

  it('stores context and questionPlan internally when starting', async () => {
    const result = await started();
    const saved = (await repository.findById(result.id))!;
    expect(saved.context).toBe('internal-context-marker');
    expect(saved.questionPlan).toHaveLength(5);
    expect(result).not.toHaveProperty('context');
    expect(result).not.toHaveProperty('questionPlan');
  });

  it.each([5, 8])('completes exactly %i questions in three stages', async (count) => {
    const result = await started(count);
    let question = result.question;
    const stages = [question.stage];
    for (let index = 0; index < count; index++) {
      const answer = await service.submitAnswer('owner', result.id, { questionId: question.questionId, answerText: 'Confirmed answer' });
      expect(answer.completed).toBe(index === count - 1);
      if (answer.question) { question = answer.question; stages.push(question.stage); }
    }
    expect(stages).toEqual(['OPENING', ...Array(count - 2).fill('TECHNICAL'), 'CLOSING']);
    const saved = (await repository.findById(result.id))!;
    expect(saved.status).toBe('ENDED');
    expect(saved.turns.filter(t => t.answerText !== undefined)).toHaveLength(count);
    expect(saved.pendingNextQuestion).toBe(false);
    expect(ai.generateNextQuestion).toHaveBeenCalledTimes(count - 1);
    expect(ai.generateNextQuestion.mock.calls[0][0]).toMatchObject({
      context: 'internal-context-marker', nextQuestionIndex: 1,
      questionPlan: expect.any(Array), transcript: [expect.objectContaining({ answerText: 'Confirmed answer' })],
    });
  });

  it.each([[180000, false], [180001, true]])('uses a strict 180s timeout at %i ms', async (milliseconds, timedOut) => {
    const result = await started();
    const saved = (await repository.findById(result.id))!;
    saved.turns[0].askedAt = new Date(1000000);
    await repository.save(saved);
    const now = jest.spyOn(Date, 'now').mockReturnValue(1000000 + milliseconds);
    try {
      const answer = await service.submitAnswer('owner', result.id, { questionId: result.question.questionId, answerText: 'Late answer' });
      expect(answer.acceptedAnswer.timedOut).toBe(timedOut);
      expect((await repository.findById(result.id))!.turns[0].elapsedSeconds).toBe(milliseconds / 1000);
    } finally { now.mockRestore(); }
  });

  it('logs latency without question, answer or session content', async () => {
    const result = await started();
    await service.submitAnswer('owner', result.id, { questionId: result.question.questionId, answerText: 'private-answer-marker' });
    const metric = latencyLog.mock.calls[0][0];
    expect(Object.keys(metric).sort()).toEqual(['durationMs', 'event']);
    expect(metric.event).toBe('generateNextQuestion');
    expect(metric.durationMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(latencyLog.mock.calls)).not.toContain('private-answer-marker');
  });

  it('preserves the CV technical-question quota across the actual interview', async () => {
    service = new VmiService(repository, ai, { getSummary: jest.fn().mockResolvedValue({ id: 'cv', summary: 'Project' }) });
    const originalInit = ai.initInterviewContext.getMockImplementation()!;
    ai.initInterviewContext.mockImplementation(async input => {
      const result = await originalInit(input);
      result.questionPlan[1].cvBased = true;
      result.questionPlan[2].cvBased = true;
      return result;
    });
    const created = await service.createSession('owner', { ...setup, cvId: 'cv', targetQuestionCount: 5 });
    const result = await service.startSession('owner', created.id, { deviceReady: true });
    let question = result.question;
    for (let index = 0; index < 5; index++) {
      const answer = await service.submitAnswer('owner', result.id, { questionId: question.questionId, answerText: 'Answer' });
      if (answer.question) question = answer.question;
    }
    const saved = (await repository.findById(result.id))!;
    expect(saved.turns.filter(t => t.stage === 'TECHNICAL' && t.cvBased)).toHaveLength(2);
  });

  it('rejects foreign, stale and duplicate answers', async () => {
    const result = await started();
    const answer = { questionId: result.question.questionId, answerText: 'Answer' };
    await expect(service.submitAnswer('other', result.id, answer)).rejects.toMatchObject({ status: 404 });
    await expect(service.submitAnswer('owner', result.id, { ...answer, questionId: 'wrong' })).rejects.toMatchObject({ status: 409 });
    await service.submitAnswer('owner', result.id, answer);
    await expect(service.submitAnswer('owner', result.id, answer)).rejects.toMatchObject({ status: 409 });
    expect(ai.generateNextQuestion).toHaveBeenCalledTimes(1);
  });

  it.each([502, 503, 504])('preserves an answer before an AI %i failure and blocks resubmission', async status => {
    const result = await started();
    ai.generateNextQuestion.mockImplementationOnce(async () => {
      const saved = (await repository.findById(result.id))!;
      expect(saved.pendingNextQuestion).toBe(true);
      expect(saved.turns[0].answerText).toBe('Preserved answer');
      if (status === 504) throw new GatewayTimeoutException('private-marker');
      if (status === 503) throw new ServiceUnavailableException('private-marker');
      throw new BadGatewayException('private-marker');
    });
    const answer = { questionId: result.question.questionId, answerText: 'Preserved answer' };
    await expect(service.submitAnswer('owner', result.id, answer)).rejects.toMatchObject({ status, response: { pendingNextQuestion: true } });
    const saved = (await repository.findById(result.id))!;
    expect(saved.turns).toHaveLength(1);
    expect(saved.turns[0].answerText).toBe(answer.answerText);
    expect(saved.status).toBe('IN_PROGRESS');
    expect(saved.lastAiError).not.toContain('private-marker');
    await expect(service.submitAnswer('owner', result.id, answer)).rejects.toMatchObject({ status: 409 });
    await expect(service.finishSession('owner', result.id)).resolves.toMatchObject({ status: 'ENDED' });
  });

  it('can finish with zero answers and rejects further submissions', async () => {
    const result = await started();
    await expect(service.finishSession('other', result.id)).rejects.toMatchObject({ status: 404 });
    await service.finishSession('owner', result.id);
    await expect(service.submitAnswer('owner', result.id, { questionId: result.question.questionId, answerText: 'Answer' })).rejects.toMatchObject({ status: 409 });
    await expect(service.finishSession('owner', result.id)).rejects.toMatchObject({ status: 409 });
  });

  it.each([false, true])('finishes during AI generation without losing the answer or reopening on late success/failure (%s)', async fail => {
    const result = await started();
    let release!: () => void;
    let entered!: () => void;
    const enteredAi = new Promise<void>(r => { entered = r; });
    ai.generateNextQuestion.mockImplementationOnce(async input => {
      entered();
      await new Promise<void>(r => { release = r; });
      if (fail) throw new GatewayTimeoutException();
      return { stage: input.stage, questionText: 'Late question', cvBased: false };
    });
    const pending = service.submitAnswer('owner', result.id, { questionId: result.question.questionId, answerText: 'Saved before AI' });
    await enteredAi;
    await expect(service.submitAnswer('owner', result.id, { questionId: result.question.questionId, answerText: 'Duplicate' })).rejects.toMatchObject({ status: 409 });
    await service.finishSession('owner', result.id);
    release();
    expect((await pending).completed).toBe(true);
    const saved = (await repository.findById(result.id))!;
    expect(saved.status).toBe('ENDED');
    expect(saved.turns).toHaveLength(1);
    expect(saved.turns[0].answerText).toBe('Saved before AI');
    expect(saved.pendingNextQuestion).toBe(false);
  });
});


describe('VmiService evaluation', () => {
  let repository: InMemoryVmiSessionRepository;
  let ai: jest.Mocked<AiProvider>;
  let service: VmiService;
  const assessment = { technical: 80, problemSolving: 50, communication: 20,
    strengths: ['Strength'], knowledgeGaps: ['Gap'], suggestedAnswers: ['Better answer'], reviewTopics: ['Topic'] };
  beforeEach(() => {
    repository = new InMemoryVmiSessionRepository();
    ai = { refineTranscript: jest.fn().mockImplementation(async input => input.rawText), initInterviewContext: jest.fn().mockResolvedValue(structuredClone(aiResult)),
      generateNextQuestion: jest.fn().mockResolvedValue({ stage: VmiStage.TECHNICAL, questionText: 'Next', cvBased: false }),
      evaluateInterview: jest.fn().mockResolvedValue({ ...assessment, overallScore: 100, band: 'GREEN' }),
    };
    service = new VmiService(repository, ai, new EmptyCvProvider());
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());
  async function ended(withAnswer = true) {
    const created = await service.createSession('owner', { ...setup, language: VmiLanguage.EN });
    const started = await service.startSession('owner', created.id, { deviceReady: true });
    if (withAnswer) await service.submitAnswer('owner', created.id, { questionId: started.question.questionId, answerText: 'Full answer' });
    await service.finishSession('owner', created.id);
    return created.id;
  }
  it('computes its own score, stores a report and returns the complete transcript', async () => {
    const id = await ended();
    const before = (await repository.findById(id))!;
    const result = await service.evaluateSession('owner', id);
    expect(result.report).toMatchObject({ ...assessment, overallScore: 59, band: 'YELLOW' });
    expect(result.report.disclaimer).toContain('does not predict hiring');
    expect(result.transcript).toHaveLength(before.turns.length);
    expect(result.transcript[0].answerText).toBe('Full answer');
    expect(result).not.toHaveProperty('context'); expect(result).not.toHaveProperty('questionPlan');
    expect(ai.evaluateInterview.mock.calls[0][0].transcript).toEqual(before.turns);
    expect(ai.evaluateInterview.mock.calls[0][0].language).toBe('en');
    expect((await repository.findById(id))!.status).toBe('EVALUATED');
    expect(await service.getReport('owner', id)).toEqual(result);
    await expect(service.evaluateSession('owner', id)).rejects.toMatchObject({ status: 409 });
    expect(ai.evaluateInterview).toHaveBeenCalledTimes(1);
  });
  it.each([[49.999, 50, 'RED'], [74.999, 75, 'YELLOW'], [50, 50, 'YELLOW'], [75, 75, 'GREEN']])('rounds only API output for %s', async (value, rounded, band) => {
    const id = await ended();
    ai.evaluateInterview.mockResolvedValue({ ...assessment, technical: value as number, problemSolving: value as number, communication: value as number });
    const result = await service.evaluateSession('owner', id);
    expect(result.report.overallScore).toBe(rounded);
    expect(result.report.band).toBe(band);
    expect((await repository.findById(id))!.report!.overallScore).toBeCloseTo(value as number, 10);
  });
  it('refuses zero-answer evaluation without saving a result', async () => {
    const id = await ended(false);
    const before = await repository.findById(id);
    await expect(service.evaluateSession('owner', id)).rejects.toMatchObject({ status: 422 });
    expect(await repository.findById(id)).toEqual(before);
    expect(ai.evaluateInterview).not.toHaveBeenCalled();
  });
  it('checks ownership, status and report availability', async () => {
    const created = await service.createSession('owner', setup);
    await expect(service.evaluateSession('other', created.id)).rejects.toMatchObject({ status: 404 });
    await expect(service.evaluateSession('owner', created.id)).rejects.toMatchObject({ status: 409 });
    await expect(service.getReport('other', created.id)).rejects.toMatchObject({ status: 404 });
    await expect(service.getReport('owner', created.id)).rejects.toMatchObject({ status: 404 });
  });
  it.each([502,503,504])('preserves every transcript field on AI %i and sets REPORT_FAILED', async status => {
    const id = await ended();
    const before = (await repository.findById(id))!;
    ai.evaluateInterview.mockRejectedValue(status === 504 ? new GatewayTimeoutException('private-marker') : status === 503 ? new ServiceUnavailableException('private-marker') : new BadGatewayException('private-marker'));
    await expect(service.evaluateSession('owner', id)).rejects.toMatchObject({ status, response: { sessionStatus: 'REPORT_FAILED', code: expect.any(String) } });
    const after = (await repository.findById(id))!;
    expect(after.status).toBe('REPORT_FAILED');
    expect(after.turns).toEqual(before.turns);
    expect(after.report).toBeUndefined();
    expect(after.context).toBe(before.context);
    expect(after.questionPlan).toEqual(before.questionPlan);
    expect(after.lastAiError).not.toContain('private-marker');
    await expect(service.evaluateSession('owner', id)).rejects.toMatchObject({ status: 409 });
    await expect(service.getReport('owner', id)).rejects.toMatchObject({ status: 404 });
  });
  it('prevents concurrent evaluation requests', async () => {
    const id = await ended();
    let release!: () => void; let entered!: () => void;
    const enteredAi = new Promise<void>(r => { entered = r; });
    ai.evaluateInterview.mockImplementationOnce(async () => { entered(); await new Promise<void>(r => { release = r; }); return assessment; });
    const pending = service.evaluateSession('owner', id);
    await enteredAi;
    await expect(service.evaluateSession('owner', id)).rejects.toMatchObject({ status: 409 });
    release(); await pending;
    expect(ai.evaluateInterview).toHaveBeenCalledTimes(1);
  });
});


describe('VmiService recovery', () => {
  let repository: InMemoryVmiSessionRepository;
  let service: VmiService;
  let ai: jest.Mocked<AiProvider>;
  const assessment = { technical: 80, problemSolving: 50, communication: 20,
    strengths: ['Strength'], knowledgeGaps: ['Gap'], suggestedAnswers: ['Guidance'], reviewTopics: ['Topic'] };
  function failure(status: number) {
    return status === 504 ? new GatewayTimeoutException('private-marker') : status === 503
      ? new ServiceUnavailableException('private-marker') : new BadGatewayException('private-marker');
  }
  beforeEach(() => {
    repository = new InMemoryVmiSessionRepository();
    ai = {
      refineTranscript: jest.fn().mockImplementation(async input => input.rawText), initInterviewContext: jest.fn().mockImplementation(async input => ({
        context: 'internal context', openingQuestion: opening,
        questionPlan: [opening, ...Array.from({ length: input.targetQuestionCount! - 2 }, () => ({
          stage: VmiStage.TECHNICAL, questionText: 'Technical', cvBased: false,
        })), { stage: VmiStage.CLOSING, questionText: 'Closing', cvBased: false }],
      })),
      generateNextQuestion: jest.fn().mockImplementation(async input => ({ stage: input.stage, questionText: 'Recovered question', cvBased: input.requireCvBased })),
      evaluateInterview: jest.fn().mockResolvedValue({ ...assessment, overallScore: 100, band: 'GREEN' }),
    };
    service = new VmiService(repository, ai, new EmptyCvProvider());
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());
  async function started() {
    const created = await service.createSession('owner', { ...setup, targetQuestionCount: 5 });
    return service.startSession('owner', created.id, { deviceReady: true });
  }
  async function pendingThird(status = 503) {
    const session = await started();
    const second = await service.submitAnswer('owner', session.id, { questionId: session.question.questionId, answerText: 'First saved answer' });
    ai.generateNextQuestion.mockRejectedValueOnce(failure(status));
    await expect(service.submitAnswer('owner', session.id, { questionId: second.question!.questionId, answerText: 'Second saved answer' })).rejects.toMatchObject({ status });
    return session.id;
  }
  async function failedReport() {
    const id = await pendingThird();
    await service.finishSession('owner', id);
    ai.evaluateInterview.mockRejectedValueOnce(failure(503));
    await expect(service.evaluateSession('owner', id)).rejects.toMatchObject({ status: 503 });
    return id;
  }

  it.each([502,503,504])('recovers question three after initial error and retry %i, without duplicating answers', async status => {
    const id = await pendingThird();
    const before = (await repository.findById(id))!;
    ai.generateNextQuestion.mockRejectedValueOnce(failure(status));
    await expect(service.retryNextQuestion('owner', id)).rejects.toMatchObject({ status, response: { pendingNextQuestion: true } });
    const stillPending = (await repository.findById(id))!;
    expect(stillPending.turns).toEqual(before.turns);
    expect(stillPending.pendingNextQuestion).toBe(true);
    expect(stillPending.lastAiError).not.toContain('private-marker');
    const result = await service.retryNextQuestion('owner', id);
    expect(result).toMatchObject({ completed: false, status: 'IN_PROGRESS', question: { stage: 'TECHNICAL' } });
    const saved = (await repository.findById(id))!;
    expect(saved.turns).toHaveLength(3);
    expect(saved.turns.slice(0,2)).toEqual(before.turns);
    expect(saved.pendingNextQuestion).toBe(false);
    expect(saved.lastAiError).toBeUndefined();
    expect(ai.generateNextQuestion.mock.calls.at(-1)![0]).toMatchObject({ transcript: before.turns, context: before.context, questionPlan: before.questionPlan });
    const calls = ai.generateNextQuestion.mock.calls.length;
    await expect(service.retryNextQuestion('owner', id)).rejects.toMatchObject({ status: 409 });
    expect(ai.generateNextQuestion).toHaveBeenCalledTimes(calls);
  });

  it.each([502,503,504])('recovers report after initial error and retry %i using the same transcript and scoring', async status => {
    const id = await failedReport();
    const before = (await repository.findById(id))!;
    ai.evaluateInterview.mockRejectedValueOnce(failure(status));
    await expect(service.retryReport('owner', id)).rejects.toMatchObject({ status, response: { sessionStatus: 'REPORT_FAILED' } });
    const stillFailed = (await repository.findById(id))!;
    expect(stillFailed.status).toBe('REPORT_FAILED');
    expect(stillFailed.turns).toEqual(before.turns);
    expect(stillFailed.report).toBeUndefined();
    expect(stillFailed.lastAiError).not.toContain('private-marker');
    const result = await service.retryReport('owner', id);
    expect(result.report).toMatchObject({ ...assessment, overallScore: 59, band: 'YELLOW' });
    const saved = (await repository.findById(id))!;
    expect(saved.status).toBe('EVALUATED');
    expect(saved.turns).toEqual(before.turns);
    expect(saved.lastAiError).toBeUndefined();
    expect(ai.evaluateInterview.mock.calls.at(-1)![0].transcript).toEqual(before.turns);
    const calls = ai.evaluateInterview.mock.calls.length;
    await expect(service.retryReport('owner', id)).rejects.toMatchObject({ status: 409 });
    await expect(service.evaluateSession('owner', id)).rejects.toMatchObject({ status: 409 });
    expect(ai.evaluateInterview).toHaveBeenCalledTimes(calls);
  });

  it.each(['SETUP','IN_PROGRESS','ENDED','EVALUATED','REPORT_FAILED'] as const)('rejects invalid retry state %s', async status => {
    const session = await started();
    const stored = (await repository.findById(session.id))!;
    stored.status = VmiSessionStatus[status];
    stored.pendingNextQuestion = status !== 'IN_PROGRESS';
    await repository.save(stored);
    await expect(service.retryNextQuestion('owner', session.id)).rejects.toMatchObject({ status: 409 });
    if (status !== 'REPORT_FAILED') await expect(service.retryReport('owner', session.id)).rejects.toMatchObject({ status: 409 });
    expect(ai.generateNextQuestion).not.toHaveBeenCalled();
    expect(ai.evaluateInterview).not.toHaveBeenCalled();
    expect(await repository.findById(session.id)).toEqual(stored);
  });

  it('hides foreign sessions and rejects an unknown ID', async () => {
    const id = await pendingThird();
    const calls = ai.generateNextQuestion.mock.calls.length;
    await expect(service.retryNextQuestion('other', id)).rejects.toMatchObject({ status: 404 });
    await expect(service.retryReport('other', id)).rejects.toMatchObject({ status: 404 });
    await expect(service.retryNextQuestion('owner', 'missing')).rejects.toMatchObject({ status: 404 });
    await expect(service.retryReport('owner', 'missing')).rejects.toMatchObject({ status: 404 });
    expect(ai.generateNextQuestion).toHaveBeenCalledTimes(calls);
  });

  it('rejects retry while the original answer generation is still running', async () => {
    const session = await started();
    let release!: () => void; let entered!: () => void;
    const enteredAi = new Promise<void>(r => { entered = r; });
    ai.generateNextQuestion.mockImplementationOnce(async input => {
      entered(); await new Promise<void>(r => { release = r; });
      return { stage: input.stage, questionText: 'Next', cvBased: false };
    });
    const original = service.submitAnswer('owner', session.id, { questionId: session.question.questionId, answerText: 'Saved answer' });
    await enteredAi;
    await expect(service.retryNextQuestion('owner', session.id)).rejects.toMatchObject({ status: 409 });
    release(); await original;
    expect(ai.generateNextQuestion).toHaveBeenCalledTimes(1);
    expect((await repository.findById(session.id))!.turns).toHaveLength(2);
  });

  it('does not run concurrent next-question retries in parallel', async () => {
    const id = await pendingThird();
    let release!: () => void; let entered!: () => void;
    const enteredAi = new Promise<void>(r => { entered = r; });
    ai.generateNextQuestion.mockImplementationOnce(async input => {
      entered(); await new Promise<void>(r => { release = r; });
      return { stage: input.stage, questionText: 'Recovered', cvBased: false };
    });
    const first = service.retryNextQuestion('owner', id);
    await enteredAi;
    const calls = ai.generateNextQuestion.mock.calls.length;
    await expect(service.retryNextQuestion('owner', id)).rejects.toMatchObject({ status: 409 });
    release(); await first;
    expect(ai.generateNextQuestion).toHaveBeenCalledTimes(calls);
    expect((await repository.findById(id))!.turns).toHaveLength(3);
  });

  it('does not run concurrent report retries in parallel and keeps evaluate ENDED-only', async () => {
    const id = await failedReport();
    let release!: () => void; let entered!: () => void;
    const enteredAi = new Promise<void>(r => { entered = r; });
    ai.evaluateInterview.mockImplementationOnce(async () => {
      entered(); await new Promise<void>(r => { release = r; }); return assessment;
    });
    const first = service.retryReport('owner', id);
    await enteredAi;
    const calls = ai.evaluateInterview.mock.calls.length;
    await expect(service.retryReport('owner', id)).rejects.toMatchObject({ status: 409 });
    await expect(service.evaluateSession('owner', id)).rejects.toMatchObject({ status: 409 });
    release(); await first;
    expect(ai.evaluateInterview).toHaveBeenCalledTimes(calls);
  });

  it('recovers the closing question, then ends on its answer without an extra question', async () => {
    const session = await started();
    let question = session.question;
    for (let index = 0; index < 3; index++) {
      const result = await service.submitAnswer('owner', session.id, { questionId: question.questionId, answerText: 'Saved' });
      question = result.question!;
    }
    ai.generateNextQuestion.mockRejectedValueOnce(failure(504));
    await expect(service.submitAnswer('owner', session.id, { questionId: question.questionId, answerText: 'Fourth answer' })).rejects.toMatchObject({ status: 504 });
    const retried = await service.retryNextQuestion('owner', session.id);
    expect(retried.question!.stage).toBe('CLOSING');
    expect(retried.completed).toBe(false);
    const calls = ai.generateNextQuestion.mock.calls.length;
    const result = await service.submitAnswer('owner', session.id, { questionId: retried.question!.questionId, answerText: 'Final answer' });
    expect(result).toMatchObject({ completed: true, status: 'ENDED' });
    expect((await repository.findById(session.id))!.turns).toHaveLength(5);
    expect(ai.generateNextQuestion).toHaveBeenCalledTimes(calls);
    await expect(service.retryNextQuestion('owner', session.id)).rejects.toMatchObject({ status: 409 });
  });

  it('completes a pending session whose final question is already answered without asking a sixth question', async () => {
    const session = await started();
    let question = session.question;
    for (let index = 0; index < 5; index++) {
      const result = await service.submitAnswer('owner', session.id, { questionId: question.questionId, answerText: 'Saved' });
      if (result.question) question = result.question;
    }
    const stored = (await repository.findById(session.id))!;
    stored.status = VmiSessionStatus.IN_PROGRESS; stored.pendingNextQuestion = true; stored.lastAiError = 'VMI_NEXT_QUESTION_TIMEOUT';
    delete stored.endedAt;
    await repository.save(stored);
    const calls = ai.generateNextQuestion.mock.calls.length;
    const result = await service.retryNextQuestion('owner', session.id);
    expect(result).toMatchObject({ completed: true, status: 'ENDED' });
    const saved = (await repository.findById(session.id))!;
    expect(saved.turns).toEqual(stored.turns);
    expect(saved.pendingNextQuestion).toBe(false); expect(saved.lastAiError).toBeUndefined();
    expect(ai.generateNextQuestion).toHaveBeenCalledTimes(calls);
  });

  it.each([false,true])('does not reopen or damage a finished session after late retry completion (%s)', async fail => {
    const id = await pendingThird();
    let release!: () => void; let entered!: () => void;
    const enteredAi = new Promise<void>(r => { entered = r; });
    ai.generateNextQuestion.mockImplementationOnce(async input => {
      entered(); await new Promise<void>(r => { release = r; });
      if (fail) throw failure(504);
      return { stage: input.stage, questionText: 'Late', cvBased: false };
    });
    const pending = service.retryNextQuestion('owner', id);
    await enteredAi;
    const before = (await repository.findById(id))!.turns;
    await service.finishSession('owner', id);
    release();
    expect((await pending).completed).toBe(true);
    const saved = (await repository.findById(id))!;
    expect(saved.status).toBe('ENDED'); expect(saved.turns).toEqual(before);
  });
});


describe('VmiService retry locking across recovery operations', () => {
  it('does not start report retry while a next-question retry is still in flight after finish', async () => {
    const repository = new InMemoryVmiSessionRepository();
    let release!: () => void; let entered!: () => void;
    const enteredAi = new Promise<void>(r => { entered = r; });
    const assessment = { technical: 80, problemSolving: 50, communication: 20,
      strengths: ['Strength'], knowledgeGaps: ['Gap'], suggestedAnswers: ['Guidance'], reviewTopics: ['Topic'] };
    const ai: jest.Mocked<AiProvider> = {
      refineTranscript: jest.fn().mockImplementation(async input => input.rawText), initInterviewContext: jest.fn().mockResolvedValue(structuredClone(aiResult)),
      generateNextQuestion: jest.fn().mockRejectedValueOnce(new GatewayTimeoutException()).mockImplementation(async input => {
        entered(); await new Promise<void>(r => { release = r; });
        return { stage: input.stage, questionText: 'Late question', cvBased: false };
      }),
      evaluateInterview: jest.fn().mockRejectedValueOnce(new GatewayTimeoutException()).mockResolvedValue(assessment),
    };
    const service = new VmiService(repository, ai, new EmptyCvProvider());
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    try {
      const created = await service.createSession('owner', setup);
      const started = await service.startSession('owner', created.id, { deviceReady: true });
      await expect(service.submitAnswer('owner', created.id, { questionId: started.question.questionId, answerText: 'Saved' })).rejects.toMatchObject({ status: 504 });
      const pending = service.retryNextQuestion('owner', created.id);
      await enteredAi;
      await service.finishSession('owner', created.id);
      await expect(service.evaluateSession('owner', created.id)).rejects.toMatchObject({ status: 504 });
      try {
        await expect(service.retryReport('owner', created.id)).rejects.toMatchObject({ status: 409 });
        expect(ai.evaluateInterview).toHaveBeenCalledTimes(1);
      } finally { release(); await pending; }
      await expect(service.retryReport('owner', created.id)).resolves.toMatchObject({ status: 'EVALUATED' });
    } finally { log.mockRestore(); }
  });
});


describe('VmiService history', () => {
  let repository: InMemoryVmiSessionRepository;
  let service: VmiService;
  let ai: jest.Mocked<AiProvider>;
  let cv: jest.Mocked<CvProvider>;
  const report = { technical: 74.999, problemSolving: 74.999, communication: 74.999,
    overallScore: 74.999, band: 'YELLOW' as const, strengths: ['Strength'], knowledgeGaps: ['Gap'],
    suggestedAnswers: ['Guidance'], reviewTopics: ['Topic'], recommendation: 'Recommendation', disclaimer: 'Training only', createdAt: new Date(5000) };
  beforeEach(() => {
    repository = new InMemoryVmiSessionRepository();
    ai = { refineTranscript: jest.fn().mockImplementation(async input => input.rawText), initInterviewContext: jest.fn(), generateNextQuestion: jest.fn(), evaluateInterview: jest.fn() };
    cv = { getSummary: jest.fn().mockResolvedValue({ id: 'cv-1', summary: 'Original CV project' }) };
    service = new VmiService(repository, ai, cv);
  });
  afterEach(() => {
    expect(ai.initInterviewContext).not.toHaveBeenCalled();
    expect(ai.generateNextQuestion).not.toHaveBeenCalled();
    expect(ai.evaluateInterview).not.toHaveBeenCalled();
  });
  async function saved(userId = 'owner', status = VmiSessionStatus.IN_PROGRESS, answerText: string | null = 'Saved answer', timestamp = 1000) {
    const created = await service.createSession(userId, setup);
    const session = (await repository.findById(created.id))!;
    session.status = status;
    session.createdAt = new Date(timestamp); session.updatedAt = new Date(timestamp);
    session.context = 'private-context'; session.questionPlan = structuredClone(aiResult.questionPlan);
    session.lastAiError = 'private-error';
    session.turns = [{ questionId: session.id, questionText: 'Opening question', stage: VmiStage.OPENING,
      askedAt: new Date(timestamp), ...(answerText !== null ? { answerText, answeredAt: new Date(timestamp + 1000), elapsedSeconds: 1, timedOut: false } : {}), cvBased: false }];
    await repository.save(session);
    return session;
  }
  it('returns an empty owner page without calling AI', async () => {
    expect(await service.listSessions('owner', { limit: 20, offset: 0 })).toEqual({ items: [], total: 0, limit: 20, offset: 0 });
  });
  it('filters SETUP and zero-answer sessions in every status before counting and paginating', async () => {
    const expected: string[] = [];
    for (const status of Object.values(VmiSessionStatus)) {
      for (const text of [null, '', '   ', 'Saved answer']) {
        const session = await saved('owner', status, text);
        if (status !== VmiSessionStatus.SETUP && text === 'Saved answer') expected.push(session.id);
      }
    }
    const page = await service.listSessions('owner', { limit: 50, offset: 0 });
    expect(page.total).toBe(4);
    expect(page.items.map((item: { id: string }) => item.id).sort()).toEqual(expected.sort());
    const limited = await service.listSessions('owner', { limit: 1, offset: 1 });
    expect(limited.total).toBe(4); expect(limited.items).toHaveLength(1);
  });
  it('sorts newest first, filters owners and paginates after filtering', async () => {
    const old = await saved('owner', VmiSessionStatus.ENDED, 'Old', 1000);
    const newest = await saved('owner', VmiSessionStatus.IN_PROGRESS, 'New', 3000);
    const middle = await saved('owner', VmiSessionStatus.REPORT_FAILED, 'Middle', 2000);
    await saved('other', VmiSessionStatus.ENDED, 'Foreign', 10000);
    await saved('owner', VmiSessionStatus.SETUP, 'Hidden setup', 20000);
    await saved('owner', VmiSessionStatus.ENDED, '', 15000);
    const all = await service.listSessions('owner', { limit: 20, offset: 0 });
    expect(all.items.map((item: { id: string }) => item.id)).toEqual([newest.id, middle.id, old.id]);
    const page = await service.listSessions('owner', { limit: 1, offset: 1 });
    expect(page).toMatchObject({ total: 3, limit: 1, offset: 1, items: [{ id: middle.id }] });
    expect(await service.listSessions('owner', { limit: 20, offset: 3 })).toEqual({ items: [], total: 3, limit: 20, offset: 3 });
    expect((await service.listSessions('other', { limit: 20, offset: 0 })).total).toBe(1);
  });
  it('orders equal timestamps deterministically by id', async () => {
    const first = await saved(); const second = await saved();
    const page = await service.listSessions('owner', { limit: 20, offset: 0 });
    expect(page.items.map((item: { id: string }) => item.id)).toEqual([first.id, second.id].sort());
  });
  it('returns detached repository pages, including nested fields and dates', async () => {
    const session = await saved();
    session.cvSnapshot = { id: 'cv-1', summary: 'Saved CV' }; session.report = structuredClone(report);
    await repository.save(session);
    const page = await repository.findManyByUserId('owner', { limit: 20, offset: 0 });
    page.items[0].cvSnapshot!.summary = 'Changed outside';
    page.items[0].report!.strengths.push('Changed outside');
    page.items[0].createdAt.setTime(99999);
    const again = await repository.findManyByUserId('owner', { limit: 20, offset: 0 });
    expect(again.items[0].cvSnapshot!.summary).toBe('Saved CV');
    expect(again.items[0].report!.strengths).toEqual(['Strength']);
    expect(again.items[0].createdAt.getTime()).toBe(1000);
  });
  it('returns only public summary fields and optional stored scores', async () => {
    const session = await saved('owner', VmiSessionStatus.EVALUATED);
    session.report = structuredClone(report); await repository.save(session);
    const page = await service.listSessions('owner', { limit: 20, offset: 0 });
    expect(page.items).toEqual([{ id: session.id, createdAt: session.createdAt, position: setup.position,
      level: setup.level, language: setup.language, status: 'EVALUATED', overallScore: 75, band: 'YELLOW' }]);
    expect((await repository.findById(session.id))!.report!.overallScore).toBe(74.999);
    const noReport = await saved('other');
    const otherPage = await service.listSessions('other', { limit: 20, offset: 0 });
    expect(otherPage.items[0].id).toBe(noReport.id);
    expect(otherPage.items[0]).not.toHaveProperty('overallScore'); expect(otherPage.items[0]).not.toHaveProperty('band');
  });
  it('returns owned detail with configuration, full transcript and report without internal state', async () => {
    const session = await saved('owner', VmiSessionStatus.EVALUATED);
    session.cvId = 'cv-1'; session.cvSnapshot = { id: 'cv-1', summary: 'Snapshot' };
    session.report = structuredClone(report); session.startedAt = new Date(1000); session.endedAt = new Date(2000);
    await repository.save(session);
    const detail = await service.getSessionDetails('owner', session.id);
    expect(Object.keys(detail).sort()).toEqual(['createdAt','cvId','cvSnapshot','endedAt','id','language','level','position','report','startedAt','status','targetQuestionCount','transcript','updatedAt'].sort());
    expect(detail).toMatchObject({ id: session.id, ...setup, targetQuestionCount: 6, cvId: 'cv-1', cvSnapshot: session.cvSnapshot, report: { overallScore: 75, band: 'YELLOW' } });
    expect(detail.transcript).toEqual([{ questionId: session.id, questionText: 'Opening question', stage: 'OPENING', askedAt: new Date(1000), answerText: 'Saved answer', answeredAt: new Date(2000), elapsedSeconds: 1, timedOut: false }]);
    const existingReport = await service.getReport('owner', session.id);
    expect(detail.report).toEqual(existingReport.report); expect(detail.transcript).toEqual(existingReport.transcript);
    expect(cv.getSummary).not.toHaveBeenCalled();
  });
  it('returns 404 for foreign and unknown detail, including SETUP', async () => {
    const session = await service.createSession('owner', setup);
    await expect(service.getSessionDetails('other', session.id)).rejects.toMatchObject({ status: 404 });
    await expect(service.getSessionDetails('owner', 'missing')).rejects.toMatchObject({ status: 404 });
    const detail = await service.getSessionDetails('owner', session.id);
    expect(detail).toMatchObject({ status: 'SETUP', transcript: [] });
    expect(detail).not.toHaveProperty('report'); expect(detail).not.toHaveProperty('cvSnapshot');
  });
  it('keeps the historical CV snapshot after original edits/deletion without refetching', async () => {
    const original = { id: 'cv-1', summary: 'Original CV project' };
    cv.getSummary.mockResolvedValue(original);
    const created = await service.createSession('owner', { ...setup, cvId: 'cv-1' });
    original.summary = 'Edited CV project';
    cv.getSummary.mockResolvedValue(null);
    const detail = await service.getSessionDetails('owner', created.id);
    expect(detail.cvSnapshot).toEqual({ id: 'cv-1', summary: 'Original CV project' });
    expect(cv.getSummary).toHaveBeenCalledTimes(1);
    detail.cvSnapshot.summary = 'Changed response';
    expect((await service.getSessionDetails('owner', created.id)).cvSnapshot.summary).toBe('Original CV project');
  });
});
