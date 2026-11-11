import type { CvSummary } from '../types/vmi.types';

export const CV_PROVIDER = Symbol('CV_PROVIDER');

export interface CvProvider {
  getSummary(userId: string, cvId: string): Promise<CvSummary | null>;
}
