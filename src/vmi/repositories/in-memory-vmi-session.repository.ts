import { Injectable } from '@nestjs/common';
import type { VmiSessionRepository, VmiSessionPage, VmiSessionPagination } from '../interfaces/vmi-session-repository.interface';
import type { VmiSession } from '../types/vmi.types';
import { VmiSessionStatus } from '../types/vmi.types';

@Injectable()
export class InMemoryVmiSessionRepository implements VmiSessionRepository {
  async findManyByUserId(userId: string, pagination: VmiSessionPagination): Promise<VmiSessionPage> {
    const matching = [...this.sessions.values()]
      .filter(session => session.userId === userId && session.status !== VmiSessionStatus.SETUP &&
        session.turns.some(turn => !!turn.answerText?.trim()))
      .sort((first, second) => second.createdAt.getTime() - first.createdAt.getTime() || first.id.localeCompare(second.id));
    return {
      items: structuredClone(matching.slice(pagination.offset, pagination.offset + pagination.limit)),
      total: matching.length,
    };
  }
  private readonly sessions = new Map<string, VmiSession>();

  async save(session: VmiSession): Promise<void> {
    this.sessions.set(session.id, structuredClone(session));
  }

  async findById(id: string): Promise<VmiSession | null> {
    const session = this.sessions.get(id);
    return session ? structuredClone(session) : null;
  }
}
