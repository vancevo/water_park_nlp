import { describe, expect, it } from 'vitest';

import { loadSearchFlags } from '../src/search/search-flags.js';

describe('loadSearchFlags', () => {
  it('defaults to hybrid OFF with safe defaults', () => {
    const flags = loadSearchFlags({});
    expect(flags.hybridEnabled).toBe(false);
    expect(flags.poolSize).toBe(50);
    expect(flags.weights).toEqual({ k: 60, lexWeight: 1, vecWeight: 1 });
  });

  it('enables hybrid and parses overrides', () => {
    const flags = loadSearchFlags({
      SEARCH_HYBRID_ENABLED: 'true',
      SEARCH_HYBRID_POOL_SIZE: '30',
      SEARCH_HYBRID_RRF_K: '40',
      SEARCH_HYBRID_LEX_WEIGHT: '0.5',
      SEARCH_HYBRID_VEC_WEIGHT: '2',
    });
    expect(flags.hybridEnabled).toBe(true);
    expect(flags.poolSize).toBe(30);
    expect(flags.weights).toEqual({ k: 40, lexWeight: 0.5, vecWeight: 2 });
  });

  it('ignores invalid numeric overrides', () => {
    const flags = loadSearchFlags({
      SEARCH_HYBRID_POOL_SIZE: '-5',
      SEARCH_HYBRID_RRF_K: 'nope',
      SEARCH_HYBRID_VEC_WEIGHT: '-1',
    });
    expect(flags.poolSize).toBe(50);
    expect(flags.weights.k).toBe(60);
    expect(flags.weights.vecWeight).toBe(1);
  });

  it('treats any value other than "true" as disabled', () => {
    expect(loadSearchFlags({ SEARCH_HYBRID_ENABLED: '1' }).hybridEnabled).toBe(
      false,
    );
    expect(
      loadSearchFlags({ SEARCH_HYBRID_ENABLED: 'yes' }).hybridEnabled,
    ).toBe(false);
  });
});
