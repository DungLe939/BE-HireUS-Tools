import type {
  InitInterviewContextInput,
  InitInterviewContextOutput,
  GenerateNextQuestionInput,
  VmiPlannedQuestion,
  EvaluateInterviewInput,
  EvaluateInterviewOutput,
} from '../types/vmi.types';

export const AI_PROVIDER = Symbol('AI_PROVIDER');

export interface AiProvider {
  evaluateInterview(input: EvaluateInterviewInput): Promise<EvaluateInterviewOutput>;
  generateNextQuestion(input: GenerateNextQuestionInput): Promise<VmiPlannedQuestion>;
  initInterviewContext(
    input: InitInterviewContextInput,
  ): Promise<InitInterviewContextOutput>;
}
