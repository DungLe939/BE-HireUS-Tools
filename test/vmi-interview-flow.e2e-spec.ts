import { Logger, GatewayTimeoutException } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { AI_PROVIDER } from '../src/vmi/interfaces/ai-provider.interface';
import { VMI_SESSION_REPOSITORY } from '../src/vmi/interfaces/vmi-session-repository.interface';
import type { VmiSessionRepository } from '../src/vmi/interfaces/vmi-session-repository.interface';

describe('VMI text interview (e2e)', () => {
  let app: INestApplication;
  let repository: VmiSessionRepository;
  const ai = { initInterviewContext: jest.fn(), generateNextQuestion: jest.fn() };
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  beforeAll(async () => {
    fetchMock = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Real network forbidden'));
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AI_PROVIDER).useValue(ai).compile();
    app = module.createNestApplication();
    await app.init();
    repository = app.get(VMI_SESSION_REPOSITORY);
  });
  beforeEach(() => {
    ai.initInterviewContext.mockReset().mockImplementation(async input => {
      const opening = { stage: 'OPENING', questionText: 'Introduce yourself', cvBased: false };
      return { context: 'private-context', openingQuestion: opening, questionPlan: [opening,
        ...Array.from({ length: input.targetQuestionCount - 2 }, () => ({ stage: 'TECHNICAL', questionText: 'Technical topic', cvBased: false })),
        { stage: 'CLOSING', questionText: 'Any questions?', cvBased: false }],
      };
    });
    ai.generateNextQuestion.mockReset().mockImplementation(async input => ({ stage: input.stage, questionText: 'Adaptive follow-up', cvBased: false }));
  });
  afterAll(async () => {
    try { expect(fetchMock).not.toHaveBeenCalled(); }
    finally { await app.close(); jest.restoreAllMocks(); }
  });

  const settings = { position: 'BACKEND', level: 'INTERN', language: 'en' };
  function post(path: string, body: object = {}, owner = 'owner') {
    return request(app.getHttpServer()).post(path).set('x-mock-user-id', owner).send(body);
  }
  async function started(count = 5) {
    const created = await post('/vmi/sessions', { ...settings, targetQuestionCount: count }).expect(201);
    return (await post(`/vmi/sessions/${created.body.id}/start`, { deviceReady: true }).expect(200)).body;
  }

  it.each([5, 8])('runs %i text questions then completes', async count => {
    const session = await started(count);
    let question = session.question;
    const stages = [question.stage];
    for (let index = 0; index < count; index++) {
      const response = await post(`/vmi/sessions/${session.id}/answers`, { questionId: question.questionId, answerText: 'Confirmed text' }).expect(200);
      expect(response.body.completed).toBe(index === count - 1);
      expect(response.body).not.toHaveProperty('context');
      expect(response.body).not.toHaveProperty('questionPlan');
      expect(response.body).not.toHaveProperty('answerText');
      if (response.body.question) { question = response.body.question; stages.push(question.stage); }
    }
    expect(stages).toEqual(['OPENING', ...Array(count - 2).fill('TECHNICAL'), 'CLOSING']);
    expect((await repository.findById(session.id))!.status).toBe('ENDED');
    await post(`/vmi/sessions/${session.id}/answers`, { questionId: question.questionId, answerText: 'Duplicate' }).expect(409);
  });

  it.each([{ answerText: 'Text' }, { questionId: 'invalid', answerText: 'Text' }, { questionId: randomUUID(), answerText: '' },
    { questionId: randomUUID(), answerText: '  ' }, { questionId: randomUUID(), answerText: 1 },
    { questionId: randomUUID(), answerText: 'Text', extra: true }])('validates confirmed text DTO %#', async body => {
    const session = await started();
    await post(`/vmi/sessions/${session.id}/answers`, body).expect(400);
    expect(ai.generateNextQuestion).not.toHaveBeenCalled();
  });

  it('rejects foreign and stale submissions', async () => {
    const session = await started();
    const body = { questionId: session.question.questionId, answerText: 'Answer' };
    await post(`/vmi/sessions/${session.id}/answers`, body, 'other').expect(404);
    await post(`/vmi/sessions/${session.id}/finish`, {}, 'other').expect(404);
    await post(`/vmi/sessions/${session.id}/answers`, { ...body, questionId: randomUUID() }).expect(409);
    await post(`/vmi/sessions/${session.id}/answers`, body).expect(200);
    await post(`/vmi/sessions/${session.id}/answers`, body).expect(409);
  });

  it('marks a late answer without discarding it', async () => {
    const session = await started();
    const saved = (await repository.findById(session.id))!;
    saved.turns[0].askedAt = new Date(Date.now() - 181000);
    await repository.save(saved);
    const response = await post(`/vmi/sessions/${session.id}/answers`, { questionId: session.question.questionId, answerText: 'Late' }).expect(200);
    expect(response.body.acceptedAnswer.timedOut).toBe(true);
  });

  it('preserves an accepted answer on AI timeout, blocks duplicates and permits finish', async () => {
    const session = await started();
    ai.generateNextQuestion.mockRejectedValueOnce(new GatewayTimeoutException('private-marker'));
    const body = { questionId: session.question.questionId, answerText: 'Saved text' };
    const response = await post(`/vmi/sessions/${session.id}/answers`, body).expect(504);
    expect(response.body).toMatchObject({ code: 'VMI_NEXT_QUESTION_TIMEOUT', pendingNextQuestion: true });
    expect(JSON.stringify(response.body)).not.toContain('private-marker');
    const saved = (await repository.findById(session.id))!;
    expect(saved.turns[0].answerText).toBe('Saved text');
    expect(saved.pendingNextQuestion).toBe(true);
    await post(`/vmi/sessions/${session.id}/answers`, body).expect(409);
    await post(`/vmi/sessions/${session.id}/finish`).expect(200);
    expect((await repository.findById(session.id))!.status).toBe('ENDED');
  });

  it('permits ending before the first answer', async () => {
    const session = await started();
    await post(`/vmi/sessions/${session.id}/finish`).expect(200);
    const saved = (await repository.findById(session.id))!;
    expect(saved.turns[0].answerText).toBeUndefined();
    expect(saved.status).toBe('ENDED');
  });
});
