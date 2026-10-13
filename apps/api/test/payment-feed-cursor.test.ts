import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import {
  decodePaymentFeedCursor,
  encodePaymentFeedCursor,
} from '../src/operations/payment-feed-cursor.js';

describe('recent payment cursor', () => {
  it('round-trips a stable timestamp and UUID without exposing raw JSON', () => {
    const cursor = {
      createdAt: new Date('2026-10-11T13:30:00.000Z'),
      id: '30000000-0000-4000-8000-000000000009',
    };
    const encoded = encodePaymentFeedCursor(cursor);
    expect(encoded).not.toContain('2026-10-11');
    expect(decodePaymentFeedCursor(encoded)).toEqual(cursor);
  });

  it.each(['not-base64', Buffer.from('{}').toString('base64url')])(
    'rejects malformed cursor %s',
    (cursor) => {
      expect(() => decodePaymentFeedCursor(cursor)).toThrow(
        BadRequestException,
      );
    },
  );
});
