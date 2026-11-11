import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from './decorators/current-user.decorator';
import { CreateVmiSessionDto } from './dto/create-vmi-session.dto';
import { StartVmiSessionDto } from './dto/start-vmi-session.dto';
import { TempAuthGuard } from './guards/temp-auth.guard';
import { VmiService } from './vmi.service';
import { SubmitVmiAnswerDto } from './dto/submit-vmi-answer.dto';

@Controller('vmi')
@UseGuards(TempAuthGuard)
export class VmiController {
  constructor(private readonly service: VmiService) {}

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
