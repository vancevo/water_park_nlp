import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { loadRuntimeConfig } from '@damsen/config';
import type { UserRole } from '@damsen/shared-types';

import type { AuthPrincipal } from './auth.models.js';

interface AccessClaims {
  sub: string;
  roles: UserRole[];
  iat: number;
  exp: number;
}

const encode = (value: string | object) =>
  Buffer.from(
    typeof value === 'string' ? value : JSON.stringify(value),
  ).toString('base64url');

@Injectable()
export class TokenService {
  readonly accessTokenExpiresIn = 15 * 60;
  private readonly authConfig = loadRuntimeConfig().auth;

  issueAccess(principal: AuthPrincipal, now: Date): string {
    const issuedAt = Math.floor(now.getTime() / 1000);
    const header = encode({ alg: 'HS256', typ: 'JWT' });
    const payload = encode({
      sub: principal.userId,
      roles: principal.roles,
      iat: issuedAt,
      exp: issuedAt + this.accessTokenExpiresIn,
    } satisfies AccessClaims);
    const signature = this.sign(`${header}.${payload}`);
    return `${header}.${payload}.${signature}`;
  }

  verifyAccess(token: string, now: Date): AuthPrincipal {
    const [header, payload, signature] = token.split('.');
    if (!header || !payload || !signature) throw new UnauthorizedException();
    const expected = this.sign(`${header}.${payload}`);
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException();
    }
    try {
      const claims = JSON.parse(
        Buffer.from(payload, 'base64url').toString('utf8'),
      ) as AccessClaims;
      if (!claims.sub || !Array.isArray(claims.roles)) throw new Error();
      if (claims.exp <= Math.floor(now.getTime() / 1000)) throw new Error();
      return { userId: claims.sub, roles: claims.roles };
    } catch {
      throw new UnauthorizedException();
    }
  }

  issueRefresh(): { id: string; token: string; tokenHash: string } {
    const id = randomUUID();
    const token = `${id}.${randomBytes(32).toString('base64url')}`;
    return { id, token, tokenHash: this.hashRefresh(token) };
  }

  refreshId(token: string): string | null {
    const id = token.split('.')[0];
    return id && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
  }

  hashRefresh(token: string): string {
    return createHmac('sha256', this.authConfig.refreshTokenSecret)
      .update(token)
      .digest('hex');
  }

  refreshMatches(hash: string, token: string): boolean {
    const expected = Buffer.from(hash);
    const actual = Buffer.from(this.hashRefresh(token));
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  }

  private sign(content: string): string {
    return createHmac('sha256', this.authConfig.accessTokenSecret)
      .update(content)
      .digest('base64url');
  }
}
