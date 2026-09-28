import type { SupportedLocale, UserRole } from '@damsen/shared-types';

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  preferredLocale: SupportedLocale;
  roles: UserRole[];
  status: 'active' | 'disabled';
}

export interface RefreshSessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt?: Date;
}

export interface AuthRepository {
  findUserByEmail(email: string): Promise<UserRecord | null>;
  findUserById(id: string): Promise<UserRecord | null>;
  createUser(user: UserRecord): Promise<void>;
  setRoles(userId: string, roles: UserRole[]): Promise<void>;
  findSession(id: string): Promise<RefreshSessionRecord | null>;
  saveSession(session: RefreshSessionRecord): Promise<void>;
  consumeSession(
    id: string,
    tokenHash: string,
    at: Date,
  ): Promise<RefreshSessionRecord | null>;
  revokeSession(id: string, at: Date): Promise<void>;
}

export const AUTH_REPOSITORY = Symbol('AUTH_REPOSITORY');
export const AUTH_CLOCK = Symbol('AUTH_CLOCK');
export const PASSWORD_HASHER = Symbol('PASSWORD_HASHER');

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(encoded: string, password: string): Promise<boolean>;
}

export interface AuthPrincipal {
  userId: string;
  roles: UserRole[];
}
