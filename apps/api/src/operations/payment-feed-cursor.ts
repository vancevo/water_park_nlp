import { BadRequestException } from '@nestjs/common';

import type { PaymentFeedCursor } from './operations.models.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function encodePaymentFeedCursor(cursor: PaymentFeedCursor): string {
  return Buffer.from(
    JSON.stringify([cursor.createdAt.toISOString(), cursor.id]),
  ).toString('base64url');
}

export function decodePaymentFeedCursor(value: string): PaymentFeedCursor {
  try {
    const decoded: unknown = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    );
    if (
      !Array.isArray(decoded) ||
      decoded.length !== 2 ||
      typeof decoded[0] !== 'string' ||
      typeof decoded[1] !== 'string' ||
      !UUID_PATTERN.test(decoded[1])
    ) {
      throw new Error('shape');
    }
    const createdAt = new Date(decoded[0]);
    if (!Number.isFinite(createdAt.getTime())) throw new Error('date');
    return { createdAt, id: decoded[1] };
  } catch {
    throw new BadRequestException('Invalid recent-payment cursor');
  }
}
