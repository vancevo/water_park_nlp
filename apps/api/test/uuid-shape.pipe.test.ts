import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { ParseUuidShapePipe } from '../src/common/uuid-shape.pipe.js';

describe('ParseUuidShapePipe', () => {
  const pipe = new ParseUuidShapePipe();

  it('accepts any 8-4-4-4-12 hex id, incl. md5-seeded ids with arbitrary version/variant bits', () => {
    for (const id of [
      '7a690593-2654-1ea1-4f71-0a1b2c3d4e5f',
      '36f81b11-bca4-ac9d-0c2e-9f8e7d6c5b4a',
      '00000000-0000-4000-8000-000000000105',
      'ABCDEF01-2345-6789-ABCD-EF0123456789',
    ])
      expect(pipe.transform(id)).toBe(id);
  });

  it('rejects anything else with 400', () => {
    for (const id of [
      '',
      'not-a-uuid',
      '7a6905932654-1ea1-4f71-0a1b2c3d4e5f',
      '7a690593-2654-1ea1-4f71-0a1b2c3d4e5g',
      "7a690593-2654-1ea1-4f71-0a1b2c3d4e5f' OR '1'='1",
      ' 7a690593-2654-1ea1-4f71-0a1b2c3d4e5f',
      '7a690593-2654-1ea1-4f71-0a1b2c3d4e5f\n',
    ])
      expect(() => pipe.transform(id)).toThrow(BadRequestException);
  });
});
