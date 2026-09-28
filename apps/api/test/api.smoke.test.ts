import 'reflect-metadata';

import { NotFoundException, type ArgumentsHost } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/bootstrap.js';
import { ApiExceptionFilter } from '../src/common/api-exception.filter.js';
import {
  requestIdMiddleware,
  type RequestWithId,
} from '../src/common/request-id.middleware.js';
import { HealthController } from '../src/health/health.controller.js';

describe('API smoke', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createApp();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('initializes and exposes health without external services', () => {
    const healthController = app.get(HealthController);

    expect(healthController.getHealth()).toEqual({ status: 'ok' });
  });

  it('preserves a supplied request ID across middleware and errors', () => {
    const setHeader = vi.fn();
    const next = vi.fn();
    const request = {
      header: vi.fn().mockReturnValue('smoke-request-id'),
    } as unknown as Request;
    const middlewareResponse = { setHeader } as unknown as Response;

    requestIdMiddleware(
      request,
      middlewareResponse,
      next as unknown as NextFunction,
    );

    expect((request as RequestWithId).requestId).toBe('smoke-request-id');
    expect(setHeader).toHaveBeenCalledWith('x-request-id', 'smoke-request-id');
    expect(next).toHaveBeenCalledOnce();

    const status = vi.fn().mockReturnThis();
    const json = vi.fn();
    const errorResponse = { status, json } as unknown as Response;
    const host = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => errorResponse,
      }),
    } as ArgumentsHost;

    new ApiExceptionFilter().catch(
      new NotFoundException('Cannot GET /missing'),
      host,
    );

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({
      code: 'NOT_FOUND',
      message: 'Cannot GET /missing',
      details: null,
      requestId: 'smoke-request-id',
    });
  });
});
