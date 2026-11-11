import { Injectable } from '@nestjs/common';
import type { VmiSessionRepository } from '../interfaces/vmi-session-repository.interface';
import type { VmiSession } from '../types/vmi.types';

@Injectable()
export class InMemoryVmiSessionRepository implements VmiSessionRepository {
  private readonly sessions = new Map<string, VmiSession>();

  async save(session: VmiSession): Promise<void> {
    this.sessions.set(session.id, structuredClone(session));
  }

  async findById(id: string): Promise<VmiSession | null> {
    const session = this.sessions.get(id);
    return session ? structuredClone(session) : null;
  }
}
