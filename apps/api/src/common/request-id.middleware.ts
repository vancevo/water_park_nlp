import { randomUUID } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';

export interface RequestWithId extends Request {
  requestId: string;
}

export function requestIdMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const incomingRequestId = request.header(REQUEST_ID_HEADER)?.trim();
  const requestId = incomingRequestId || randomUUID();

  (request as RequestWithId).requestId = requestId;
  response.setHeader(REQUEST_ID_HEADER, requestId);
  next();
}
