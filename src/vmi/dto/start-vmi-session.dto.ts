import { Equals, IsBoolean } from 'class-validator';

export class StartVmiSessionDto {
  @IsBoolean()
  @Equals(true)
  deviceReady: boolean;
}
