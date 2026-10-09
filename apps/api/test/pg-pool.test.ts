import type { EventEmitter } from 'node:events';

import { describe, expect, it } from 'vitest';

import { createPgPool } from '../src/common/pg-pool.js';

describe('createPgPool', () => {
  it('survives an idle-client error (DB restart) instead of crashing the process', async () => {
    const lines: string[] = [];
    const pool = createPgPool<EventEmitter & { end(): Promise<void> }>(
      'postgresql://user:secret@127.0.0.1:9/db',
      'test',
      (line) => lines.push(line),
    );
    const error = Object.assign(
      new Error('terminating connection due to administrator command'),
      { code: '57P01' },
    );
    expect(() => pool.emit('error', error)).not.toThrow();
    expect(lines).toEqual([
      'postgres pool (test): idle client error 57P01; client discarded',
    ]);
    expect(lines.join()).not.toContain('secret');
    await pool.end();
  });
});
