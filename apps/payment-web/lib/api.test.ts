import { describe, expect, it } from 'vitest';

import { formatVnd } from './api';

describe('payment web formatting', () => {
  it('formats authoritative integer amounts as Vietnamese currency', () => {
    expect(formatVnd(200_000)).toContain('200.000');
    expect(formatVnd(200_000)).toContain('₫');
  });
});
