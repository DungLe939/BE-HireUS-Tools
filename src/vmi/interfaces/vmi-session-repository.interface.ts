import type { VmiSession } from '../types/vmi.types';

export const VMI_SESSION_REPOSITORY = Symbol('VMI_SESSION_REPOSITORY');

export interface VmiSessionRepository {
  save(session: VmiSession): Promise<void>;
  findById(id: string): Promise<VmiSession | null>;
}
