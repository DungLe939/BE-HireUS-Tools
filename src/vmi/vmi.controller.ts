import { FileInterceptor } from '@nestjs/platform-express';
import { MAX_AUDIO_BYTES } from './interfaces/stt-provider.interface';
import type { SttAudio } from './interfaces/stt-provider.interface';
import { BadRequestException, UploadedFile, UseInterceptors, Header, StreamableFile, Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from './decorators/current-user.decorator';
import { CreateVmiSessionDto } from './dto/create-vmi-session.dto';
import { StartVmiSessionDto } from './dto/start-vmi-session.dto';
import { TempAuthGuard } from './guards/temp-auth.guard';
import { VmiService } from './vmi.service';
import { SubmitVmiAnswerDto } from './dto/submit-vmi-answer.dto';
import { ListVmiSessionsQueryDto } from './dto/list-vmi-sessions-query.dto';

@Controller('vmi')
@UseGuards(TempAuthGuard)
export class VmiController {
  constructor(private readonly service: VmiService) {}

  @Post('sessions/:id/transcribe')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @UseInterceptors(FileInterceptor('audio', { limits: { fileSize: MAX_AUDIO_BYTES, files: 1, fields: 0, parts: 1 } }))
  transcribeAudio(
    @CurrentUser() userId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @UploadedFile() audio: SttAudio | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    if (Object.keys(body ?? {}).length) throw new BadRequestException('Only an audio file is accepted.');
    return this.service.transcribeAudio(userId, id, audio);
  }

  @Get('sessions/:id/questions/:questionId/audio')
  @Header('Cache-Control', 'no-store')
  async getQuestionAudio(
    @CurrentUser() userId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('questionId', new ParseUUIDPipe({ version: '4' })) questionId: string,
  ) {
    return new StreamableFile(await this.service.synthesizeQuestion(userId, id, questionId), { type: 'audio/wav' });
  }

  @Get('sessions')
  listSessions(@CurrentUser() userId: string, @Query() query: ListVmiSessionsQueryDto) {
    return this.service.listSessions(userId, query);
  }

  @Get('sessions/:id')
  getSessionDetails(
    @CurrentUser() userId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.service.getSessionDetails(userId, id);
  }

  @Post('sessions/:id/next-question/retry')
  @HttpCode(HttpStatus.OK)
  retryNextQuestion(
    @CurrentUser() userId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.service.retryNextQuestion(userId, id);
  }

  @Post('sessions/:id/report/retry')
  @HttpCode(HttpStatus.OK)
  retryReport(
    @CurrentUser() userId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.service.retryReport(userId, id);
  }

  @Post('sessions/:id/evaluate')
  @HttpCode(HttpStatus.OK)
  evaluateSession(
    @CurrentUser() userId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.service.evaluateSession(userId, id);
  }

  @Get('sessions/:id/report')
  getReport(
    @CurrentUser() userId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.service.getReport(userId, id);
  }

  @Post('sessions/:id/answers')
  @HttpCode(HttpStatus.OK)
  submitAnswer(
    @CurrentUser() userId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: SubmitVmiAnswerDto,
  ) {
    return this.service.submitAnswer(userId, id, input);
  }

  @Post('sessions/:id/finish')
  @HttpCode(HttpStatus.OK)
  finishSession(
    @CurrentUser() userId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.service.finishSession(userId, id);
  }

  @Get('options')
  getOptions() {
    return this.service.getOptions();
  }

  @Post('sessions')
  createSession(@CurrentUser() userId: string, @Body() input: CreateVmiSessionDto) {
    return this.service.createSession(userId, input);
  }

  @Post('sessions/:id/start')
  @HttpCode(HttpStatus.OK)
  startSession(
    @CurrentUser() userId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: StartVmiSessionDto,
  ) {
    return this.service.startSession(userId, id, input);
  }
}
