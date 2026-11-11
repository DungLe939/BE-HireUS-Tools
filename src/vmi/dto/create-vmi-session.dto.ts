import { IsEnum, IsInt, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { VmiLanguage, VmiLevel, VmiPosition } from '../types/vmi.types';

export class CreateVmiSessionDto {
  @IsEnum(VmiPosition)
  position: VmiPosition;

  @IsEnum(VmiLevel)
  level: VmiLevel;

  @IsEnum(VmiLanguage)
  language: VmiLanguage;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Matches(/^\S+$/)
  @MaxLength(200)
  cvId?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(5)
  @Max(8)
  targetQuestionCount?: number;
}
