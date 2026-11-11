import { Injectable } from '@nestjs/common';
import type { CvProvider } from '../interfaces/cv-provider.interface';
import type { CvSummary } from '../types/vmi.types';

@Injectable()
export class EmptyCvProvider implements CvProvider {
  getSummary(_userId: string, _cvId: string): Promise<CvSummary | null> {
    return Promise.resolve(null);
  }
}
