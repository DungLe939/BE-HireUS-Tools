import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from './decorators/current-user.decorator';
import { CreateVmiSessionDto } from './dto/create-vmi-session.dto';
import { StartVmiSessionDto } from './dto/start-vmi-session.dto';
import { TempAuthGuard } from './guards/temp-auth.guard';
import { VmiService } from './vmi.service';

@Controller('vmi')
@UseGuards(TempAuthGuard)
export class VmiController {
  constructor(private readonly service: VmiService) {}

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
