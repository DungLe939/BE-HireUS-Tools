import { Module, ValidationPipe } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { TempAuthGuard } from './guards/temp-auth.guard';
import { CV_PROVIDER } from './interfaces/cv-provider.interface';
import { AI_PROVIDER } from './interfaces/ai-provider.interface';
import { EmptyCvProvider } from './providers/empty-cv.provider';
import { GeminiAiProvider } from './providers/gemini-ai.provider';

@Module({
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
    { provide: AI_PROVIDER, useClass: GeminiAiProvider },
  ],
  exports: [TempAuthGuard, CV_PROVIDER, AI_PROVIDER],
})
export class VmiModule {}
