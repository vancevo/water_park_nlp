import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  Req,
  ValidationPipe,
} from '@nestjs/common';
import type { AuthResponse } from '@damsen/shared-types';
import type { Request } from 'express';

import { AuthService } from './auth.service.js';
import { DemoPhoneSessionDto } from './auth.dto.js';

const demoBodyPipe = new ValidationPipe({
  expectedType: DemoPhoneSessionDto,
  forbidNonWhitelisted: true,
  transform: true,
  whitelist: true,
});

@Controller('v1/demo-auth')
export class DemoAuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post('phone-session')
  @HttpCode(200)
  createPhoneSession(
    @Req() request: Request,
    @Body(demoBodyPipe) input: DemoPhoneSessionDto,
  ): Promise<AuthResponse> {
    const header = (name: string) => {
      const value = request.headers[name];
      return Array.isArray(value) ? value[0] : value;
    };
    return this.auth.demoPhoneSession(input, {
      ip: request.ip,
      sessionId: header('x-demo-session-id'),
      deviceId: header('x-demo-device-id'),
    });
  }
}
