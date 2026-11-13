import type { VmiSession } from '../types/vmi.types';

export const VMI_SESSION_REPOSITORY = Symbol('VMI_SESSION_REPOSITORY');

export interface VmiSessionPagination {
  limit: number;
  offset: number;
}

export interface VmiSessionPage {
  items: VmiSession[];
  total: number;
}

export interface VmiSessionRepository {
  /** Owner's non-SETUP sessions with an answer, filtered before pagination; createdAt DESC, id ASC. */
  findManyByUserId(userId: string, pagination: VmiSessionPagination): Promise<VmiSessionPage>;
  save(session: VmiSession): Promise<void>;
  findById(id: string): Promise<VmiSession | null>;
}
