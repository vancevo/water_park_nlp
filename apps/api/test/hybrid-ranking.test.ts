import { describe, expect, it } from 'vitest';

import { fuseRankings } from '../src/search/hybrid-ranking.js';

describe('fuseRankings', () => {
  it('keeps the order when both rankings agree', () => {
    const fused = fuseRankings(['a', 'b', 'c'], ['a', 'b', 'c']);
    expect(fused.map((e) => e.id)).toEqual(['a', 'b', 'c']);
    expect(fused.every((e) => e.inLexical && e.inVector)).toBe(true);
  });

  it('promotes an item the vector ranks highly', () => {
    // Lexical order a,b,c; vector ranks only c → c should move up.
    const fused = fuseRankings(['a', 'b', 'c'], ['c']);
    expect(fused[0]!.id).toBe('c');
    expect(fused.find((e) => e.id === 'c')!.inVector).toBe(true);
    expect(fused.find((e) => e.id === 'a')!.inVector).toBe(false);
  });

  it('includes ids present only in the vector ranking', () => {
    const fused = fuseRankings(['a'], ['z']);
    expect(new Set(fused.map((e) => e.id))).toEqual(new Set(['a', 'z']));
  });

  it('breaks ties deterministically by id', () => {
    const fused = fuseRankings(['a', 'b'], ['b', 'a']);
    // Symmetric RRF → equal scores → id asc.
    expect(fused.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('falls back to lexical order when vecWeight is 0', () => {
    const fused = fuseRankings(['a', 'b', 'c'], ['c', 'b', 'a'], {
      k: 60,
      lexWeight: 1,
      vecWeight: 0,
    });
    expect(fused.map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });
});
