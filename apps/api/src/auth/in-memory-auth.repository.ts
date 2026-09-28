import { Injectable } from '@nestjs/common';
import type { UserRole } from '@damsen/shared-types';

import type {
  AuthRepository,
  RefreshSessionRecord,
  UserRecord,
} from './auth.models.js';

@Injectable()
export class InMemoryAuthRepository implements AuthRepository {
  private readonly users = new Map<string, UserRecord>();
  private readonly sessions = new Map<string, RefreshSessionRecord>();

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    return (
      [...this.users.values()].find((user) => user.email === email) ?? null
    );
  }

  async findUserById(id: string): Promise<UserRecord | null> {
    return this.users.get(id) ?? null;
  }

  async createUser(user: UserRecord): Promise<void> {
    if (await this.findUserByEmail(user.email)) throw new Error('EMAIL_EXISTS');
    this.users.set(user.id, structuredClone(user));
  }

  async setRoles(userId: string, roles: UserRole[]): Promise<void> {
    const user = this.users.get(userId);
    if (!user) throw new Error('USER_NOT_FOUND');
    user.roles = [...roles];
  }

  async findSession(id: string): Promise<RefreshSessionRecord | null> {
    return this.sessions.get(id) ?? null;
  }

  async saveSession(session: RefreshSessionRecord): Promise<void> {
    this.sessions.set(session.id, { ...session });
  }

  async consumeSession(
    id: string,
    tokenHash: string,
    at: Date,
  ): Promise<RefreshSessionRecord | null> {
    const session = this.sessions.get(id);
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= at ||
      session.tokenHash !== tokenHash
    ) {
      return null;
    }
    session.revokedAt = at;
    return { ...session };
  }

  async revokeSession(id: string, at: Date): Promise<void> {
    const session = this.sessions.get(id);
    if (session) session.revokedAt = at;
  }
}
