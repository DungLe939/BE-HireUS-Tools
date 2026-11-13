import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AI_PROVIDER } from '../src/vmi/interfaces/ai-provider.interface';
import { CV_PROVIDER } from '../src/vmi/interfaces/cv-provider.interface';
import { VMI_SESSION_REPOSITORY } from '../src/vmi/interfaces/vmi-session-repository.interface';
import type { VmiSessionRepository } from '../src/vmi/interfaces/vmi-session-repository.interface';
import { VmiLanguage, VmiLevel, VmiPosition, VmiSessionStatus, VmiStage } from '../src/vmi/types/vmi.types';
import type { CvSummary, VmiSession } from '../src/vmi/types/vmi.types';

describe('VMI history (e2e)', () => {
  let app: INestApplication;
  let repository: VmiSessionRepository;
  let fetchMock: jest.SpiedFunction<typeof fetch>;
  let sourceCv: CvSummary | null;
  const ai = { refineTranscript: jest.fn().mockImplementation(async input => input.rawText), initInterviewContext: jest.fn(), generateNextQuestion: jest.fn(), evaluateInterview: jest.fn() };
  const cv = { getSummary: jest.fn() };
  const settings = { position: 'BACKEND', level: 'FRESHER', language: 'en', targetQuestionCount: 5 };

  beforeAll(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Real network forbidden'));
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  beforeEach(async () => {
    sourceCv = { id: 'cv-1', summary: 'Original CV project' };
    cv.getSummary.mockReset().mockImplementation(async (userId, cvId) => userId === 'owner' && cvId === 'cv-1' ? sourceCv : null);
    ai.initInterviewContext.mockReset().mockImplementation(async input => {
      const opening = { stage: 'OPENING', questionText: 'Opening question', cvBased: false };
      return { context: 'private-context-marker', openingQuestion: opening, questionPlan: [opening,
        ...Array.from({ length: input.targetQuestionCount - 2 }, () => ({ stage: 'TECHNICAL', questionText: 'Technical question', cvBased: !!input.cvSnapshot })),
        { stage: 'CLOSING', questionText: 'Closing question', cvBased: false }],
      };
    });
    ai.generateNextQuestion.mockReset().mockImplementation(async input => ({ stage: input.stage, questionText: 'Follow-up question', cvBased: input.requireCvBased }));
    ai.evaluateInterview.mockReset().mockResolvedValue({ technical: 74.999, problemSolving: 74.999, communication: 74.999,
      strengths: ['Strength'], knowledgeGaps: ['Gap'], suggestedAnswers: ['Guidance'], reviewTopics: ['Topic'] });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AI_PROVIDER).useValue(ai)
      .overrideProvider(CV_PROVIDER).useValue(cv).compile();
    app = module.createNestApplication(); await app.init();
    repository = app.get(VMI_SESSION_REPOSITORY);
  });
  afterEach(async () => { await app.close(); });
  afterAll(() => {
    try { expect(fetchMock).not.toHaveBeenCalled(); }
    finally { jest.restoreAllMocks(); }
  });

  function list(query = '', owner = 'owner') {
    return request(app.getHttpServer()).get(`/vmi/sessions${query ? '?' + query : ''}`).set('x-mock-user-id', owner);
  }
  function detail(id: string, owner = 'owner') {
    return request(app.getHttpServer()).get(`/vmi/sessions/${id}`).set('x-mock-user-id', owner);
  }
  function post(id: string, action: string, body: object = {}, owner = 'owner') {
    return request(app.getHttpServer()).post(`/vmi/sessions/${id}/${action}`).set('x-mock-user-id', owner).send(body);
  }
  async function created(owner = 'owner', withCv = false) {
    return (await request(app.getHttpServer()).post('/vmi/sessions').set('x-mock-user-id', owner)
      .send({ ...settings, ...(withCv ? { cvId: 'cv-1' } : {}) }).expect(201)).body;
  }
  async function answered(owner = 'owner', withCv = false) {
    const session = await created(owner, withCv);
    const started = (await post(session.id, 'start', { deviceReady: true }, owner).expect(200)).body;
    await post(session.id, 'answers', { questionId: started.question.questionId, answerText: 'Saved confirmed answer' }, owner).expect(200);
    return session.id as string;
  }
  async function seed(owner = 'owner', status = VmiSessionStatus.IN_PROGRESS, answered = true, timestamp = 1000) {
    const session: VmiSession = {
      id: randomUUID(), userId: owner, position: VmiPosition.BACKEND, level: VmiLevel.FRESHER,
      language: VmiLanguage.EN, status, targetQuestionCount: 5, pendingNextQuestion: false,
      createdAt: new Date(timestamp), updatedAt: new Date(timestamp), context: 'private-context-marker',
      lastAiError: 'private-error-marker',
      turns: [{ questionId: randomUUID(), questionText: 'Saved question', stage: VmiStage.OPENING, askedAt: new Date(timestamp), cvBased: false,
        ...(answered ? { answerText: 'Saved answer', answeredAt: new Date(timestamp + 1000), elapsedSeconds: 1, timedOut: false } : {}),
      }],
    };
    await repository.save(session);
    return session;
  }

  it('returns an empty default page without AI calls', async () => {
    expect((await list().expect(200)).body).toEqual({ items: [], total: 0, limit: 20, offset: 0 });
    expect(ai.initInterviewContext).not.toHaveBeenCalled();
    expect(ai.generateNextQuestion).not.toHaveBeenCalled(); expect(ai.evaluateInterview).not.toHaveBeenCalled();
  });

  it('includes an interview only after an answer, hiding SETUP and zero-answer ENDED', async () => {
    const setupOnly = await created();
    const empty = await created();
    await post(empty.id, 'start', { deviceReady: true }).expect(200);
    await post(empty.id, 'finish').expect(200);
    expect((await list().expect(200)).body.total).toBe(0);
    const id = await answered();
    const response = await list().expect(200);
    expect(response.body.items.map((item: { id: string }) => item.id)).toEqual([id]);
    expect(response.body.items[0]).not.toHaveProperty('overallScore');
    expect(response.body.items[0]).not.toHaveProperty('band');
    expect((await detail(setupOnly.id).expect(200)).body).toMatchObject({ status: 'SETUP', transcript: [] });
    expect((await detail(empty.id).expect(200)).body.status).toBe('ENDED');
  });

  it('filters all zero-answer states and all SETUP records before counting', async () => {
    const expected: string[] = [];
    for (const status of Object.values(VmiSessionStatus)) {
      await seed('owner', status, false);
      const withAnswer = await seed('owner', status, true);
      if (status !== VmiSessionStatus.SETUP) expected.push(withAnswer.id);
    }
    const response = await list('limit=50').expect(200);
    expect(response.body.total).toBe(4);
    expect(response.body.items.map((item: { id: string }) => item.id).sort()).toEqual(expected.sort());
  });

  it('sorts newest first and applies ownership/filtering before offset pagination', async () => {
    const oldest = await seed('owner', VmiSessionStatus.ENDED, true, 1000);
    const newest = await seed('owner', VmiSessionStatus.IN_PROGRESS, true, 3000);
    const middle = await seed('owner', VmiSessionStatus.REPORT_FAILED, true, 2000);
    await seed('owner', VmiSessionStatus.SETUP, false, 20000);
    await seed('owner', VmiSessionStatus.ENDED, false, 15000);
    const foreign = await seed('other', VmiSessionStatus.ENDED, true, 10000);
    const all = await list().expect(200);
    expect(all.body.total).toBe(3);
    expect(all.body.items.map((item: { id: string }) => item.id)).toEqual([newest.id, middle.id, oldest.id]);
    const page = await list('limit=1&offset=1').expect(200);
    expect(page.body).toMatchObject({ total: 3, limit: 1, offset: 1, items: [{ id: middle.id }] });
    expect((await list('', 'other').expect(200)).body.items.map((item: { id: string }) => item.id)).toEqual([foreign.id]);
    expect((await list('offset=3').expect(200)).body).toEqual({ items: [], total: 3, limit: 20, offset: 3 });
  });

  it('uses default limit 20 and supports maximum limit 50 with offset pages', async () => {
    const sessions: VmiSession[] = [];
    for (let index = 0; index < 55; index++) sessions.push(await seed('owner', VmiSessionStatus.ENDED, true, index + 1000));
    const expected = sessions.map(session => session.id).reverse();
    const defaultPage = await list().expect(200);
    expect(defaultPage.body).toMatchObject({ total: 55, limit: 20, offset: 0 });
    expect(defaultPage.body.items.map((item: { id: string }) => item.id)).toEqual(expected.slice(0,20));
    expect((await list('limit=50').expect(200)).body.items).toHaveLength(50);
    const finalPage = await list('limit=20&offset=50').expect(200);
    expect(finalPage.body.items.map((item: { id: string }) => item.id)).toEqual(expected.slice(50));
    const distant = await list('offset=9007199254740991').expect(200);
    expect(distant.body).toMatchObject({ total: 55, items: [], offset: 9007199254740991 });
  });

  it('uses a stable ID tie-break for equal creation timestamps', async () => {
    const first = await seed(); const second = await seed();
    const response = await list().expect(200);
    expect(response.body.items.map((item: { id: string }) => item.id)).toEqual([first.id, second.id].sort());
  });

  it.each([
    'limit=0','limit=51','limit=-1','limit=1.5','limit=abc','limit=','limit=01','limit=1e1',
    'limit=1&limit=2','limit[]=1','offset=-1','offset=0.1','offset=abc','offset=',
    'offset=01','offset=1e1','offset=9007199254740992','offset=Infinity','offset=0&offset=1',
    'userId=other','sort=asc',
  ])('rejects invalid pagination or unexpected query: %s', async query => {
    const response = await list(query).expect(400);
    expect(response.body).toMatchObject({ statusCode: 400, error: 'Bad Request', message: expect.any(Array) });
    expect(ai.initInterviewContext).not.toHaveBeenCalled(); expect(cv.getSummary).not.toHaveBeenCalled();
  });

  it('returns 404 for foreign/missing detail and 400 for malformed IDs', async () => {
    const id = await answered();
    const foreign = await detail(id, 'other').expect(404);
    const missing = await detail(randomUUID()).expect(404);
    expect(foreign.body).toEqual(missing.body);
    await detail('invalid-id').expect(400);
    const setup = await created(); await detail(setup.id, 'other').expect(404);
  });

  it('returns full public detail and stored report without internal fields or AI calls', async () => {
    const id = await answered('owner', true);
    await post(id, 'finish').expect(200); await post(id, 'evaluate').expect(200);
    const saved = (await repository.findById(id))!;
    saved.lastAiError = 'private-error-marker';
    Object.assign(saved.report!, { context: 'report-internal-marker' });
    Object.assign(saved.cvSnapshot!, { userId: 'cv-internal-marker' });
    Object.assign(saved.turns[0], { internalNote: 'turn-internal-marker' });
    await repository.save(saved);
    const initCalls = ai.initInterviewContext.mock.calls.length;
    const generationCalls = ai.generateNextQuestion.mock.calls.length;
    const evaluationCalls = ai.evaluateInterview.mock.calls.length;
    const cvCalls = cv.getSummary.mock.calls.length;
    const response = await detail(id).expect(200);
    expect(Object.keys(response.body).sort()).toEqual(['createdAt','cvId','cvSnapshot','endedAt','id','language','level','position','report','startedAt','status','targetQuestionCount','transcript','updatedAt'].sort());
    expect(response.body).toMatchObject({ id, ...settings, cvId: 'cv-1', cvSnapshot: { id: 'cv-1', summary: 'Original CV project' }, report: { overallScore: 75, band: 'YELLOW' } });
    expect(response.body.transcript).toHaveLength(2);
    expect(response.body.transcript[0]).toMatchObject({ questionText: 'Opening question', answerText: 'Saved confirmed answer' });
    const content = JSON.stringify(response.body);
    for (const marker of ['private-context-marker','private-error-marker','report-internal-marker','cv-internal-marker','turn-internal-marker']) expect(content).not.toContain(marker);
    for (const key of ['userId','context','questionPlan','lastAiError','pendingNextQuestion','cvBased','internalNote']) expect(content).not.toContain(`"${key}":`);
    const history = (await list().expect(200)).body.items[0];
    expect(Object.keys(history).sort()).toEqual(['id','createdAt','position','level','language','status','overallScore','band'].sort());
    expect(history).toMatchObject({ overallScore: 75, band: 'YELLOW' });
    expect((await repository.findById(id))!.report!.overallScore).toBeCloseTo(74.999,10);
    expect(ai.initInterviewContext).toHaveBeenCalledTimes(initCalls); expect(ai.generateNextQuestion).toHaveBeenCalledTimes(generationCalls);
    expect(ai.evaluateInterview).toHaveBeenCalledTimes(evaluationCalls); expect(cv.getSummary).toHaveBeenCalledTimes(cvCalls);
  });

  it('preserves cvSnapshot after original CV edits/deletion without any refetch', async () => {
    const id = await answered('owner', true);
    sourceCv!.summary = 'Edited original CV';
    sourceCv = null;
    const response = await detail(id).expect(200);
    expect(response.body.cvSnapshot).toEqual({ id: 'cv-1', summary: 'Original CV project' });
    expect(cv.getSummary).toHaveBeenCalledTimes(1);
    await list().expect(200);
    expect(cv.getSummary).toHaveBeenCalledTimes(1);
    expect((await detail(id).expect(200)).body.cvSnapshot).toEqual(response.body.cvSnapshot);
    await request(app.getHttpServer()).post('/vmi/sessions').set('x-mock-user-id', 'owner')
      .send({ ...settings, cvId: 'cv-1' }).expect(404);
    expect((await detail(id).expect(200)).body.cvSnapshot).toEqual(response.body.cvSnapshot);
  });

  it('provides configuration for frontend replay without registering a replay endpoint', async () => {
    const id = await answered();
    const response = await detail(id).expect(200);
    const { position, level, language, targetQuestionCount, cvId } = response.body;
    const replayed = await request(app.getHttpServer()).post('/vmi/sessions').set('x-mock-user-id', 'owner')
      .send({ position, level, language, targetQuestionCount, ...(cvId ? { cvId } : {}) }).expect(201);
    expect(replayed.body.id).not.toBe(id);
    expect(replayed.body).toMatchObject({ ...settings, status: 'SETUP' });
    await post(id, 'replay').expect(404);
  });
});
