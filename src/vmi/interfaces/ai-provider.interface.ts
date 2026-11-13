import type {
  InitInterviewContextInput,
  InitInterviewContextOutput,
  GenerateNextQuestionInput,
  VmiPlannedQuestion,
  EvaluateInterviewInput,
  EvaluateInterviewOutput,
} from '../types/vmi.types';

export const AI_PROVIDER = Symbol('AI_PROVIDER');

export interface RefineTranscriptInput {
  rawText: string;
  question: string;
  position: import('../types/vmi.types').VmiPosition;
  level: import('../types/vmi.types').VmiLevel;
  language: import('../types/vmi.types').VmiLanguage;
  cvTerms: string[];
}

export interface AiProvider {
  refineTranscript(input: RefineTranscriptInput): Promise<string>;
  evaluateInterview(input: EvaluateInterviewInput): Promise<EvaluateInterviewOutput>;
  generateNextQuestion(input: GenerateNextQuestionInput): Promise<VmiPlannedQuestion>;
  initInterviewContext(
    input: InitInterviewContextInput,
  ): Promise<InitInterviewContextOutput>;
}
