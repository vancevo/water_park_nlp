import { HttpException, HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import {
  ApiExceptionFilter,
  isServiceUnavailableError,
} from '../src/common/api-exception.filter.js';

function run(exception: unknown) {
  const json = vi.fn<(body: Record<string, unknown>) => void>();
  const status = vi.fn<(code: number) => { json: typeof json }>(() => ({
    json,
  }));
  new ApiExceptionFilter().catch(exception, {
    switchToHttp: () => ({
      getRequest: () => ({ requestId: 'req-1' }),
      getResponse: () => ({ status }),
    }),
  } as never);
  return { status: status.mock.calls[0]?.[0], body: json.mock.calls[0]?.[0] };
}

describe('F6: database outage answers 503, bugs stay 500', () => {
  it.each([
    [{ code: 'ECONNREFUSED' }],
    [{ code: '57P01' }],
    [{ code: '08006' }],
    [{ code: '53300' }],
    [new Error('Connection terminated unexpectedly')],
    [new Error('timeout exceeded when trying to connect')],
  ])('maps %j to 503 SERVICE_UNAVAILABLE', (error) => {
    expect(isServiceUnavailableError(error)).toBe(true);
    const { status, body } = run(error);
    expect(status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect(body).toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      requestId: 'req-1',
      details: null,
    });
  });

  it('keeps unexpected errors as 500 INTERNAL_ERROR and hides the message', () => {
    const { status, body } = run(new Error('secret connection string'));
    expect(status).toBe(500);
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    });
  });

  it('does not touch explicit HttpExceptions', () => {
    const { status, body } = run(
      new HttpException({ code: 'CUSTOM', message: 'x' }, 409),
    );
    expect(status).toBe(409);
    expect(body?.code).toBe('CUSTOM');
  });
});
