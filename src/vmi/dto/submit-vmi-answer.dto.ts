import { IsString, IsUUID, Matches, MaxLength } from 'class-validator';

export class SubmitVmiAnswerDto {
  @IsUUID('4')
  questionId: string;

  @IsString()
  @Matches(/\S/)
  @MaxLength(20000)
  answerText: string;
}
