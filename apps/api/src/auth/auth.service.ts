import { randomUUID } from 'node:crypto';

import {
  ConflictException,
  Inject,
  Injectable,
  type OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthResponse, AuthUser } from '@damsen/shared-types';

import type { LoginDto, RegisterDto } from './auth.dto.js';
import {
  AUTH_CLOCK,
  AUTH_REPOSITORY,
  PASSWORD_HASHER,
  type AuthRepository,
  type PasswordHasher,
  type UserRecord,
} from './auth.models.js';
import { TokenService } from './token.service.js';

const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class AuthService implements OnModuleInit {
  constructor(
    @Inject(AUTH_REPOSITORY) private readonly repository: AuthRepository,
    @Inject(PASSWORD_HASHER) private readonly passwords: PasswordHasher,
    @Inject(AUTH_CLOCK) private readonly now: () => Date,
    @Inject(TokenService) private readonly tokens: TokenService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (
      process.env.NODE_ENV === 'production' ||
      process.env.DEV_SEED_ADMIN !== 'true'
    ) {
      return;
    }

    const email = (process.env.DEV_ADMIN_EMAIL ?? 'admin@damsen.local')
      .trim()
      .toLowerCase();
    const password = process.env.DEV_ADMIN_PASSWORD;
    if (!password || password.length < 10) {
      throw new Error(
        'DEV_ADMIN_PASSWORD must contain at least 10 characters when DEV_SEED_ADMIN=true',
      );
    }
    if (await this.repository.findUserByEmail(email)) return;

    await this.repository.createUser({
      id: randomUUID(),
      email,
      passwordHash: await this.passwords.hash(password),
      preferredLocale: 'vi',
      roles: ['ADMIN'],
      status: 'active',
    });
  }

  async register(input: RegisterDto): Promise<AuthResponse> {
    if (await this.repository.findUserByEmail(input.email)) {
      throw new ConflictException('Email is already registered');
    }
    const user: UserRecord = {
      id: randomUUID(),
      email: input.email,
      passwordHash: await this.passwords.hash(input.password),
      preferredLocale: input.preferredLocale,
      roles: ['VISITOR'],
      status: 'active',
    };
    try {
      await this.repository.createUser(user);
    } catch (error) {
      if (error instanceof Error && error.message === 'EMAIL_EXISTS') {
        throw new ConflictException('Email is already registered');
      }
      throw error;
    }
    return this.createSession(user);
  }

  async login(input: LoginDto): Promise<AuthResponse> {
    const user = await this.repository.findUserByEmail(input.email);
    if (
      !user ||
      user.status !== 'active' ||
      !(await this.passwords.verify(user.passwordHash, input.password))
    ) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return this.createSession(user);
  }

  async refresh(refreshToken: string): Promise<AuthResponse> {
    const id = this.tokens.refreshId(refreshToken);
    const now = this.now();
    const session = id
      ? await this.repository.consumeSession(
          id,
          this.tokens.hashRefresh(refreshToken),
          now,
        )
      : null;
    if (!session) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    const user = await this.repository.findUserById(session.userId);
    if (!user || user.status !== 'active') throw new UnauthorizedException();
    return this.createSession(user);
  }

  async logout(refreshToken: string): Promise<void> {
    const id = this.tokens.refreshId(refreshToken);
    if (id) await this.repository.revokeSession(id, this.now());
  }

  private async createSession(user: UserRecord): Promise<AuthResponse> {
    const now = this.now();
    const refresh = this.tokens.issueRefresh();
    await this.repository.saveSession({
      id: refresh.id,
      userId: user.id,
      tokenHash: refresh.tokenHash,
      expiresAt: new Date(now.getTime() + REFRESH_TTL_MS),
    });
    return {
      user: this.publicUser(user),
      accessToken: this.tokens.issueAccess(
        { userId: user.id, roles: user.roles },
        now,
      ),
      refreshToken: refresh.token,
      accessTokenExpiresIn: this.tokens.accessTokenExpiresIn,
    };
  }

  private publicUser(user: UserRecord): AuthUser {
    return {
      id: user.id,
      email: user.email,
      preferredLocale: user.preferredLocale,
      roles: user.roles,
    };
  }
}
