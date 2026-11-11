import { randomUUID } from 'node:crypto';
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  GatewayTimeoutException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AI_PROVIDER } from './interfaces/ai-provider.interface';
import type { AiProvider } from './interfaces/ai-provider.interface';
import { CV_PROVIDER } from './interfaces/cv-provider.interface';
import type { CvProvider } from './interfaces/cv-provider.interface';
import { VMI_SESSION_REPOSITORY } from './interfaces/vmi-session-repository.interface';
import type { VmiSessionRepository } from './interfaces/vmi-session-repository.interface';
import type { CreateVmiSessionDto } from './dto/create-vmi-session.dto';
import type { StartVmiSessionDto } from './dto/start-vmi-session.dto';
import { VmiLanguage, VmiLevel, VmiPosition, VmiSessionStatus } from './types/vmi.types';
import type { InitInterviewContextOutput, VmiSession, VmiTurn } from './types/vmi.types';

@Injectable()
export class VmiService {
  // Matches the single-process scope of the temporary in-memory repository.
  private readonly startingSessions = new Set<string>();

  constructor(
    @Inject(VMI_SESSION_REPOSITORY) private readonly repository: VmiSessionRepository,
    @Inject(AI_PROVIDER) private readonly ai: AiProvider,
    @Inject(CV_PROVIDER) private readonly cv: CvProvider,
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
        turns: [question],
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
