import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { VmiModule } from './vmi/vmi.module';

@Module({
  imports: [VmiModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
