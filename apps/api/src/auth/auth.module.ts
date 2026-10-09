import { Module } from '@nestjs/common';

import { AuthController } from './auth.controller.js';
import { AUTH_CLOCK, AUTH_REPOSITORY, PASSWORD_HASHER } from './auth.models.js';
import { AuthService } from './auth.service.js';
import { InMemoryAuthRepository } from './in-memory-auth.repository.js';
import { Argon2idPasswordHasher } from './password-hasher.js';
import { AccessTokenGuard, RolesGuard } from './rbac.js';
import { TokenService } from './token.service.js';
import { PostgresAuthRepository } from './postgres-auth.repository.js';
import type { AuthRepository } from './auth.models.js';
import type { SqlClient } from '../poi/postgres-poi.repository.js';
import { createPgPool } from '../common/pg-pool.js';

function createAuthRepository(): AuthRepository {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return new InMemoryAuthRepository();
  return new PostgresAuthRepository(
    createPgPool<SqlClient>(connectionString, 'auth'),
  );
}

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    AccessTokenGuard,
    RolesGuard,
    { provide: AUTH_REPOSITORY, useFactory: createAuthRepository },
    { provide: PASSWORD_HASHER, useClass: Argon2idPasswordHasher },
    { provide: AUTH_CLOCK, useValue: () => new Date() },
  ],
  exports: [
    AuthService,
    TokenService,
    AccessTokenGuard,
    RolesGuard,
    AUTH_REPOSITORY,
    AUTH_CLOCK,
  ],
})
export class AuthModule {}
