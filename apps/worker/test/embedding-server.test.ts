import type { Server } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createEmbeddingServer,
  listen,
  type TextEmbeddingModel,
} from '../src/embedding/embedding-server.js';
import {
  EmbeddingServiceError,
  HttpEmbeddingProvider,
} from '../src/embedding/http-embedding-provider.js';

/** Deterministic 1024-d fake: vector[i] depends on text length only. */
function fakeModel(
  overrides: Partial<TextEmbeddingModel> = {},
): TextEmbeddingModel {
  return {
    model: 'BAAI/bge-m3',
    modelVersion: 'test@q8',
    dimensions: 1024,
    async embed(texts) {
      return texts.map((t) =>
        Array.from({ length: 1024 }, (_, i) => ((t.length + i) % 7) / 7),
      );
    },
    ...overrides,
  };
}

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((s) => new Promise((r) => s.close(() => r(null)))),
  );
});

async function start(load: () => Promise<TextEmbeddingModel>) {
  const handle = createEmbeddingServer(load);
  servers.push(handle.server);
  const port = await listen(handle.server, 0, '127.0.0.1');
  return { handle, base: `http://127.0.0.1:${port}` };
}

const post = (url: string, body: unknown) =>
  fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('embedding server (C06)', () => {
  it('reports ready with model info and embeds one text (API contract)', async () => {
    const { handle, base } = await start(async () => fakeModel());
    await handle.ready;
    const health = await (await fetch(`${base}/healthz`)).json();
    expect(health).toEqual({
      status: 'ready',
      model: 'BAAI/bge-m3',
      modelVersion: 'test@q8',
      dimensions: 1024,
    });
    const res = await post(`${base}/embed`, {
      text: 'tôi muốn xem biểu diễn âm nhạc',
      locale: 'vi',
      model: 'BAAI/bge-m3',
      modelVersion: 'test@q8',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { vector: number[] };
    expect(body.vector).toHaveLength(1024);
  });

  it('embeds a batch and validates the request', async () => {
    const { handle, base } = await start(async () => fakeModel());
    await handle.ready;
    const ok = await post(`${base}/embed/batch`, { texts: ['a', 'bb'] });
    expect(((await ok.json()) as { vectors: number[][] }).vectors).toHaveLength(
      2,
    );
    expect((await post(`${base}/embed/batch`, { texts: [] })).status).toBe(400);
    expect((await post(`${base}/embed`, { text: '   ' })).status).toBe(400);
    expect(
      (await post(`${base}/embed`, { text: 'x'.repeat(5000) })).status,
    ).toBe(400);
    expect((await fetch(`${base}/embed`)).status).toBe(405);
    expect((await fetch(`${base}/nope`)).status).toBe(404);
    const bad = await fetch(`${base}/embed`, { method: 'POST', body: '{oops' });
    expect(bad.status).toBe(400);
  });

  it('refuses another model/version so mismatched vectors are never compared', async () => {
    const { handle, base } = await start(async () => fakeModel());
    await handle.ready;
    const res = await post(`${base}/embed`, {
      text: 'x',
      modelVersion: 'other',
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ code: 'MODEL_MISMATCH' });
  });

  it('answers 503 while loading and after a failed load', async () => {
    let release!: (m: TextEmbeddingModel) => void;
    const { handle, base } = await start(
      () => new Promise<TextEmbeddingModel>((r) => (release = r)),
    );
    expect((await fetch(`${base}/healthz`)).status).toBe(503);
    expect((await post(`${base}/embed`, { text: 'x' })).status).toBe(503);
    release(fakeModel());
    await handle.ready;
    expect((await fetch(`${base}/healthz`)).status).toBe(200);

    const failed = await start(async () => {
      throw new Error('download failed');
    });
    await failed.handle.ready.catch(() => undefined);
    const health = await (await fetch(`${failed.base}/healthz`)).json();
    expect(health.status).toBe('failed');
  });

  it('rejects wrong-sized model output instead of serving it', async () => {
    const { handle, base } = await start(async () =>
      fakeModel({ embed: async (t) => t.map(() => [1, 2, 3]) }),
    );
    await handle.ready;
    expect((await post(`${base}/embed`, { text: 'x' })).status).toBe(500);
  });
});

describe('HttpEmbeddingProvider (C06 indexer)', () => {
  it('takes model/version from the service and embeds documents', async () => {
    const { handle, base } = await start(async () => fakeModel());
    await handle.ready;
    const provider = await HttpEmbeddingProvider.connect({ url: base });
    expect(provider.model).toBe('BAAI/bge-m3');
    expect(provider.modelVersion).toBe('test@q8');
    const vectors = await provider.embed(['doc a', 'doc bb']);
    expect(vectors).toHaveLength(2);
    expect(vectors[0]).toHaveLength(1024);
  });

  it('waits for the model, then fails fast when it cannot load', async () => {
    const failed = await start(async () => {
      throw new Error('no network');
    });
    await expect(
      HttpEmbeddingProvider.connect({ url: failed.base, pollMs: 10 }),
    ).rejects.toBeInstanceOf(EmbeddingServiceError);
    await expect(
      HttpEmbeddingProvider.connect({
        url: 'http://127.0.0.1:1',
        waitMs: 50,
        pollMs: 10,
      }),
    ).rejects.toThrow(/NOT_READY/);
  });
});
