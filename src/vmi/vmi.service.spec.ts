import { BadGatewayException, GatewayTimeoutException, ServiceUnavailableException } from '@nestjs/common';
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
    ai = { initInterviewContext: jest.fn().mockResolvedValue(structuredClone(aiResult)) };
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
