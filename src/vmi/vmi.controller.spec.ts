import { Test } from '@nestjs/testing';
import { VmiLanguage, VmiLevel, VmiPosition } from './types/vmi.types';
import { VmiController } from './vmi.controller';
import { VmiService } from './vmi.service';

describe('VmiController', () => {
  const service = {
    getOptions: jest.fn(), createSession: jest.fn(), startSession: jest.fn(),
  };
  let controller: VmiController;

  beforeEach(async () => {
    jest.resetAllMocks();
    const module = await Test.createTestingModule({
      controllers: [VmiController], providers: [{ provide: VmiService, useValue: service }],
    }).compile();
    controller = module.get(VmiController);
    await module.close();
  });

  it('returns service settings', () => {
    service.getOptions.mockReturnValue({ languages: ['vi', 'en'] });
    expect(controller.getOptions()).toEqual({ languages: ['vi', 'en'] });
  });

  it('passes the guard-assigned owner and configuration to creation', async () => {
    const input = { position: VmiPosition.MOBILE, level: VmiLevel.FRESHER, language: VmiLanguage.EN };
    service.createSession.mockResolvedValue({ id: 'created', status: 'SETUP' });
    await expect(controller.createSession('owner', input)).resolves.toEqual({ id: 'created', status: 'SETUP' });
    expect(service.createSession).toHaveBeenCalledWith('owner', input);
  });

  it('passes the guard-assigned owner, session ID and readiness to start', async () => {
    service.startSession.mockResolvedValue({ id: 'session', status: 'IN_PROGRESS' });
    await expect(controller.startSession('owner', 'session', { deviceReady: true })).resolves.toEqual({ id: 'session', status: 'IN_PROGRESS' });
    expect(service.startSession).toHaveBeenCalledWith('owner', 'session', { deviceReady: true });
  });
});
