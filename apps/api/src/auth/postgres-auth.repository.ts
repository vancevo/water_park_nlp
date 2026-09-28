import type { UserRole } from '@damsen/shared-types';

import type { SqlClient } from '../poi/postgres-poi.repository.js';
import type {
  AuthRepository,
  RefreshSessionRecord,
  UserRecord,
} from './auth.models.js';

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  preferred_locale: 'vi' | 'en';
  status: 'active' | 'disabled';
  roles: UserRole[] | string;
}

export class PostgresAuthRepository implements AuthRepository {
  constructor(private readonly client: SqlClient) {}

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    return this.findUser('lower(u.email) = lower($1)', email);
  }

  async findUserById(id: string): Promise<UserRecord | null> {
    return this.findUser('u.id = $1', id);
  }

  async createUser(user: UserRecord): Promise<void> {
    try {
      await this.client.query(
        `WITH inserted AS (
           INSERT INTO users (id, email, password_hash, preferred_locale, status)
           VALUES ($1, $2, $3, $4, $5) RETURNING id
         )
         INSERT INTO user_roles (user_id, role_name)
         SELECT inserted.id, role FROM inserted CROSS JOIN unnest($6::text[]) role`,
        [
          user.id,
          user.email,
          user.passwordHash,
          user.preferredLocale,
          user.status,
          user.roles,
        ],
      );
    } catch (error) {
      if ((error as { code?: string }).code === '23505')
        throw new Error('EMAIL_EXISTS');
      throw error;
    }
  }

  async setRoles(userId: string, roles: UserRole[]): Promise<void> {
    await this.client.query('DELETE FROM user_roles WHERE user_id = $1', [
      userId,
    ]);
    await this.client.query(
      'INSERT INTO user_roles (user_id, role_name) SELECT $1, role FROM unnest($2::text[]) role',
      [userId, roles],
    );
  }

  async findSession(id: string): Promise<RefreshSessionRecord | null> {
    const result = await this.client.query<{
      id: string;
      user_id: string;
      token_hash: string;
      expires_at: Date | string;
      revoked_at: Date | string | null;
    }>(
      'SELECT id, user_id, token_hash, expires_at, revoked_at FROM refresh_tokens WHERE id = $1',
      [id],
    );
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          userId: row.user_id,
          tokenHash: row.token_hash,
          expiresAt: new Date(row.expires_at),
          revokedAt: row.revoked_at ? new Date(row.revoked_at) : undefined,
        }
      : null;
  }

  async saveSession(session: RefreshSessionRecord): Promise<void> {
    await this.client.query(
      `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, revoked_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET token_hash = EXCLUDED.token_hash, expires_at = EXCLUDED.expires_at, revoked_at = EXCLUDED.revoked_at`,
      [
        session.id,
        session.userId,
        session.tokenHash,
        session.expiresAt,
        session.revokedAt ?? null,
      ],
    );
  }

  async consumeSession(
    id: string,
    tokenHash: string,
    at: Date,
  ): Promise<RefreshSessionRecord | null> {
    const result = await this.client.query<{
      id: string;
      user_id: string;
      token_hash: string;
      expires_at: Date | string;
      revoked_at: Date | string;
    }>(
      `UPDATE refresh_tokens SET revoked_at = $3
       WHERE id = $1 AND token_hash = $2 AND revoked_at IS NULL AND expires_at > $3
       RETURNING id, user_id, token_hash, expires_at, revoked_at`,
      [id, tokenHash, at],
    );
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          userId: row.user_id,
          tokenHash: row.token_hash,
          expiresAt: new Date(row.expires_at),
          revokedAt: new Date(row.revoked_at),
        }
      : null;
  }

  async revokeSession(id: string, at: Date): Promise<void> {
    await this.client.query(
      'UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, $2) WHERE id = $1',
      [id, at],
    );
  }

  private async findUser(
    condition: string,
    value: string,
  ): Promise<UserRecord | null> {
    const result = await this.client.query<UserRow>(
      `SELECT u.id, u.email, u.password_hash, u.preferred_locale, u.status,
       COALESCE(array_agg(ur.role_name) FILTER (WHERE ur.role_name IS NOT NULL), ARRAY[]::varchar[]) AS roles
       FROM users u LEFT JOIN user_roles ur ON ur.user_id = u.id
       WHERE ${condition} GROUP BY u.id`,
      [value],
    );
    const row = result.rows[0];
    if (!row) return null;
    const roles =
      typeof row.roles === 'string'
        ? (row.roles
            .replace(/[{}]/g, '')
            .split(',')
            .filter(Boolean) as UserRole[])
        : row.roles;
    return {
      id: row.id,
      email: row.email,
      passwordHash: row.password_hash,
      preferredLocale: row.preferred_locale,
      status: row.status,
      roles,
    };
  }
}
