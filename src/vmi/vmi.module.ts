import { STT_PROVIDER } from './interfaces/stt-provider.interface';
import { WhisperSttProvider } from './providers/whisper-stt.provider';
import { TTS_PROVIDER } from './interfaces/tts-provider.interface';
import { ZonosTtsProvider } from './providers/zonos-tts.provider';
import { VieneuTtsProvider } from './providers/vieneu-tts.provider';
import { Module, ValidationPipe } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { TempAuthGuard } from './guards/temp-auth.guard';
import { CV_PROVIDER } from './interfaces/cv-provider.interface';
import { AI_PROVIDER } from './interfaces/ai-provider.interface';
import { EmptyCvProvider } from './providers/empty-cv.provider';
import { GeminiAiProvider } from './providers/gemini-ai.provider';
import { VMI_SESSION_REPOSITORY } from './interfaces/vmi-session-repository.interface';
import { InMemoryVmiSessionRepository } from './repositories/in-memory-vmi-session.repository';
import { VmiController } from './vmi.controller';
import { VmiService } from './vmi.service';

@Module({
  controllers: [VmiController],
  providers: [
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    },
    TempAuthGuard,
    { provide: CV_PROVIDER, useClass: EmptyCvProvider },
    { provide: STT_PROVIDER, useClass: WhisperSttProvider },
    {
      provide: TTS_PROVIDER,
      // Chỉ bật VieNeu khi môi trường đã cấu hình dịch vụ và hai giọng.
      useFactory: () => {
        const engine = process.env.VMI_TTS_ENGINE ?? 'zonos';
        if (engine === 'vieneu') return new VieneuTtsProvider();
        if (engine === 'zonos') return new ZonosTtsProvider();
        throw new Error('VMI_TTS_ENGINE chỉ nhận zonos hoặc vieneu.');
      },
    },
    { provide: AI_PROVIDER, useClass: GeminiAiProvider },
    { provide: VMI_SESSION_REPOSITORY, useClass: InMemoryVmiSessionRepository },
    VmiService,
  ],
  exports: [TempAuthGuard, CV_PROVIDER, AI_PROVIDER],
})
export class VmiModule {}
