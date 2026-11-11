import type {
  InitInterviewContextInput,
  InitInterviewContextOutput,
} from '../types/vmi.types';

export const AI_PROVIDER = Symbol('AI_PROVIDER');

export interface AiProvider {
  initInterviewContext(
    input: InitInterviewContextInput,
  ): Promise<InitInterviewContextOutput>;
}
