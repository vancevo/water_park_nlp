import {
  Catch,
  HttpException,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { ApiErrorEnvelope } from '@damsen/shared-types';
import type { Response } from 'express';

import type { RequestWithId } from './request-id.middleware.js';

interface NestErrorBody {
  code?: string;
  details?: unknown;
  error?: string;
  message?: string | string[];
  statusCode?: number;
}

const CONNECTIVITY_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EPIPE',
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
  '53300', // too_many_connections
]);

/**
 * A database/network outage (pg or socket level) rather than a bug: answer 503
 * so clients and load balancers retry, instead of a generic 500. Matches by
 * stable code/SQLSTATE class 08, never by message text that could hold data.
 */
export function isServiceUnavailableError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (typeof code === 'string') {
    if (CONNECTIVITY_CODES.has(code) || code.startsWith('08')) return true;
  }
  return (
    typeof message === 'string' &&
    (message === 'Connection terminated unexpectedly' ||
      message === 'timeout exceeded when trying to connect')
  );
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<RequestWithId>();
    const response = http.getResponse<Response>();
    const unavailable =
      !(exception instanceof HttpException) &&
      isServiceUnavailableError(exception);
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : unavailable
          ? HttpStatus.SERVICE_UNAVAILABLE
          : HttpStatus.INTERNAL_SERVER_ERROR;
    const body =
      exception instanceof HttpException
        ? exception.getResponse()
        : unavailable
          ? 'Service temporarily unavailable'
          : 'Internal server error';
    const normalized = this.normalizeBody(body, status);
    const envelope: ApiErrorEnvelope = {
      code: normalized.code,
      message: normalized.message,
      details: normalized.details,
      requestId: request.requestId,
    };

    response.status(status).json(envelope);
  }

  private normalizeBody(
    body: string | object,
    status: number,
  ): Pick<ApiErrorEnvelope, 'code' | 'message' | 'details'> {
    if (typeof body === 'string') {
      return {
        code: this.codeFor(status),
        message: body,
        details: null,
      };
    }

    const nestBody = body as NestErrorBody;
    const rawMessage = nestBody.message ?? 'Request failed';

    return {
      code: nestBody.code ?? this.codeFor(status),
      message: Array.isArray(rawMessage) ? 'Validation failed' : rawMessage,
      details: Array.isArray(rawMessage)
        ? rawMessage
        : (nestBody.details ?? null),
    };
  }

  private codeFor(status: number): string {
    if (status === HttpStatus.NOT_FOUND) return 'NOT_FOUND';
    if (status === HttpStatus.BAD_REQUEST) return 'BAD_REQUEST';
    if (status === HttpStatus.SERVICE_UNAVAILABLE) return 'SERVICE_UNAVAILABLE';
    if (status >= 500) return 'INTERNAL_ERROR';
    return `HTTP_${status}`;
  }
}
