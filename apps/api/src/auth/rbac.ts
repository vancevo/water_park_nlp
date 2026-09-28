import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '@damsen/shared-types';
import type { Request } from 'express';

import { AUTH_CLOCK, type AuthPrincipal } from './auth.models.js';
import { TokenService } from './token.service.js';
import { Inject } from '@nestjs/common';

export const ROLES_KEY = 'required_roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

export interface AuthenticatedRequest extends Request {
  principal?: AuthPrincipal;
}

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(AUTH_CLOCK) private readonly now: () => Date,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const value = request.headers.authorization;
    if (!value?.startsWith('Bearer ')) throw new UnauthorizedException();
    request.principal = this.tokens.verifyAccess(value.slice(7), this.now());
    return true;
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;
    const principal = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>().principal;
    if (
      !principal ||
      !required.some((role) => principal.roles.includes(role))
    ) {
      throw new ForbiddenException('Insufficient role');
    }
    return true;
  }
}
