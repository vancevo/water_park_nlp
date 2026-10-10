import type { EmbeddingProvider } from './types.js';

/**
 * Embedding provider backed by the embedding service (`embedding-server.ts`),
 * used by the POI indexer. Model and version come from the service's
 * `/healthz`, so stored document vectors are labelled with exactly the model
 * the API's query embedder will use (`SEARCH_EMBEDDING_MODEL[_VERSION]`).
 */

export class EmbeddingServiceError extends Error {
  constructor(readonly code: string) {
    super(`embedding service: ${code}`);
    this.name = 'EmbeddingServiceError';
  }
}

export interface HttpEmbeddingProviderOptions {
  url: string;
  timeoutMs?: number;
  fetchImpl?: typeof globalThis.fetch;
}

interface Health {
  status?: unknown;
  model?: unknown;
  modelVersion?: unknown;
  dimensions?: unknown;
}

export class HttpEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 1024 as const;

  private constructor(
    readonly model: string,
    readonly modelVersion: string,
    private readonly options: Required<
      Pick<HttpEmbeddingProviderOptions, 'url' | 'timeoutMs'>
    > & { fetchImpl: typeof globalThis.fetch },
  ) {}

  /** Waits until the service reports `ready` (model loaded) or times out. */
  static async connect(
    options: HttpEmbeddingProviderOptions & {
      waitMs?: number;
      pollMs?: number;
    },
  ): Promise<HttpEmbeddingProvider> {
    const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    const base = options.url.replace(/\/+$/u, '');
    const deadline = Date.now() + (options.waitMs ?? 600_000);
    let last = 'unreachable';
    for (;;) {
      try {
        const res = await fetchImpl(`${base}/healthz`);
        const health = (await res.json()) as Health;
        last = String(health.status ?? res.status);
        if (health.status === 'failed')
          throw new EmbeddingServiceError('MODEL_FAILED');
        if (res.ok && health.status === 'ready') {
          if (health.dimensions !== 1024)
            throw new EmbeddingServiceError('DIMENSIONS_NOT_1024');
          if (
            typeof health.model !== 'string' ||
            typeof health.modelVersion !== 'string'
          )
            throw new EmbeddingServiceError('NO_MODEL_INFO');
          return new HttpEmbeddingProvider(health.model, health.modelVersion, {
            url: base,
            timeoutMs: options.timeoutMs ?? 120_000,
            fetchImpl,
          });
        }
      } catch (error) {
        if (error instanceof EmbeddingServiceError) throw error;
      }
      if (Date.now() >= deadline)
        throw new EmbeddingServiceError(`NOT_READY (${last})`);
      await new Promise((r) => setTimeout(r, options.pollMs ?? 2000));
    }
  }

  async embed(
    documents: readonly string[],
  ): Promise<readonly (readonly number[])[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const res = await this.options.fetchImpl(
        `${this.options.url}/embed/batch`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            texts: documents,
            model: this.model,
            modelVersion: this.modelVersion,
          }),
          signal: controller.signal,
        },
      );
      if (!res.ok) throw new EmbeddingServiceError(`HTTP_${res.status}`);
      const body = (await res.json()) as { vectors?: unknown };
      const vectors = body.vectors;
      if (
        !Array.isArray(vectors) ||
        vectors.length !== documents.length ||
        !vectors.every(
          (v) =>
            Array.isArray(v) &&
            v.length === this.dimensions &&
            v.every((x) => typeof x === 'number' && Number.isFinite(x)),
        )
      )
        throw new EmbeddingServiceError('BAD_RESPONSE');
      return vectors as number[][];
    } finally {
      clearTimeout(timer);
    }
  }
}
