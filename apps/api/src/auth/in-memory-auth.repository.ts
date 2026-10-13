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
  private readonly phoneUsers = new Map<string, string>();

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    return (
      [...this.users.values()].find((user) => user.email === email) ?? null
    );
  }

  async findUserByPhoneHash(phoneHash: string): Promise<UserRecord | null> {
    const id = this.phoneUsers.get(phoneHash);
    return id ? (this.users.get(id) ?? null) : null;
  }

  async findUserById(id: string): Promise<UserRecord | null> {
    return this.users.get(id) ?? null;
  }

  async createUser(user: UserRecord): Promise<void> {
    if (!user.email || !user.passwordHash) throw new Error('EMAIL_REQUIRED');
    if (await this.findUserByEmail(user.email)) throw new Error('EMAIL_EXISTS');
    this.users.set(user.id, structuredClone(user));
  }

  async updatePasswordHash(
    userId: string,
    passwordHash: string,
    at: Date,
  ): Promise<void> {
    const user = this.users.get(userId);
    if (!user) throw new Error('USER_NOT_FOUND');
    user.passwordHash = passwordHash;
    for (const session of this.sessions.values()) {
      if (session.userId === userId && !session.revokedAt) {
        session.revokedAt = at;
      }
    }
  }

  async createDemoPhoneUser(
    user: UserRecord,
    phoneHash: string,
    phoneLast4: string,
  ): Promise<void> {
    if (this.phoneUsers.has(phoneHash)) throw new Error('PHONE_EXISTS');
    this.users.set(user.id, {
      ...structuredClone(user),
      phoneMasked: `+84•••••${phoneLast4}`,
      authMethods: ['demo_phone'],
    });
    this.phoneUsers.set(phoneHash, user.id);
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
