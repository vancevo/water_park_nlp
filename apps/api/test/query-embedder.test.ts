import { describe, expect, it, vi } from 'vitest';

import {
  HttpQueryEmbedder,
  NullQueryEmbedder,
  loadQueryEmbedder,
} from '../src/search/query-embedder.js';

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  } as unknown as Response;
}

describe('NullQueryEmbedder', () => {
  it('always returns null (lexical fallback)', async () => {
    await expect(new NullQueryEmbedder().embed('x', 'vi')).resolves.toBeNull();
  });
});

describe('HttpQueryEmbedder', () => {
  const base = {
    url: 'https://embed.test/v1',
    model: 'bge-m3',
    modelVersion: 'v1',
    dimensions: 1024,
  };

  it('returns a correctly-sized vector', async () => {
    const vector = Array.from({ length: 1024 }, () => 0.1);
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ vector }));
    const embedder = new HttpQueryEmbedder({ ...base, fetchImpl });
    await expect(embedder.embed('đầm sen', 'vi')).resolves.toHaveLength(1024);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('returns null on a wrong-sized vector', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ vector: [1, 2, 3] }));
    const embedder = new HttpQueryEmbedder({ ...base, fetchImpl });
    await expect(embedder.embed('x', 'vi')).resolves.toBeNull();
  });

  it('returns null on a non-OK response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, false));
    const embedder = new HttpQueryEmbedder({ ...base, fetchImpl });
    await expect(embedder.embed('x', 'vi')).resolves.toBeNull();
  });

  it('returns null when fetch throws', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network'));
    const embedder = new HttpQueryEmbedder({ ...base, fetchImpl });
    await expect(embedder.embed('x', 'vi')).resolves.toBeNull();
  });
});

describe('loadQueryEmbedder', () => {
  it('returns the null embedder without SEARCH_EMBEDDING_URL', () => {
    expect(loadQueryEmbedder({})).toBeInstanceOf(NullQueryEmbedder);
  });

  it('returns the HTTP embedder when the URL is set', () => {
    expect(
      loadQueryEmbedder({ SEARCH_EMBEDDING_URL: 'https://embed.test' }),
    ).toBeInstanceOf(HttpQueryEmbedder);
  });
});
