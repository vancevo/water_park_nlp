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

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<RequestWithId>();
    const response = http.getResponse<Response>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const body =
      exception instanceof HttpException
        ? exception.getResponse()
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
    if (status >= 500) return 'INTERNAL_ERROR';
    return `HTTP_${status}`;
  }
}
