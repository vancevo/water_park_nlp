import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  ValidationPipe,
} from '@nestjs/common';
import type { AuthResponse } from '@damsen/shared-types';

import { AuthService } from './auth.service.js';
import { LoginDto, LogoutDto, RefreshDto, RegisterDto } from './auth.dto.js';

const bodyPipe = <T>(expectedType: new () => T) =>
  new ValidationPipe({
    expectedType,
    forbidNonWhitelisted: true,
    transform: true,
    whitelist: true,
  });

@Controller('v1/auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post('register')
  register(
    @Body(bodyPipe(RegisterDto)) input: RegisterDto,
  ): Promise<AuthResponse> {
    return this.auth.register(input);
  }

  @Post('login')
  @HttpCode(200)
  login(@Body(bodyPipe(LoginDto)) input: LoginDto): Promise<AuthResponse> {
    return this.auth.login(input);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(
    @Body(bodyPipe(RefreshDto)) input: RefreshDto,
  ): Promise<AuthResponse> {
    return this.auth.refresh(input.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Body(bodyPipe(LogoutDto)) input: LogoutDto): Promise<void> {
    await this.auth.logout(input.refreshToken);
  }
}
