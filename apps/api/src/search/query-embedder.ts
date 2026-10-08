import type { QueryEmbedder } from './search.models.js';

/**
 * Query embedders (AI07). The null embedder disables the semantic path (search
 * stays lexical); the HTTP embedder calls an out-of-process embedding service
 * so no model runs inside the API. Both fail closed to lexical: any error or a
 * wrong-shaped response returns null.
 */

export class NullQueryEmbedder implements QueryEmbedder {
  readonly model = 'none';
  readonly modelVersion = 'none';
  async embed(_text: string, _locale: 'vi' | 'en'): Promise<null> {
    void _text;
    void _locale;
    return null;
  }
}

export interface HttpQueryEmbedderConfig {
  url: string;
  model: string;
  modelVersion: string;
  dimensions: number;
  timeoutMs?: number;
  fetchImpl?: typeof globalThis.fetch;
}

export class HttpQueryEmbedder implements QueryEmbedder {
  readonly model: string;
  readonly modelVersion: string;
  private readonly dimensions: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(private readonly config: HttpQueryEmbedderConfig) {
    this.model = config.model;
    this.modelVersion = config.modelVersion;
    this.dimensions = config.dimensions;
    this.timeoutMs = config.timeoutMs ?? 2000;
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async embed(
    text: string,
    locale: 'vi' | 'en',
  ): Promise<readonly number[] | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.config.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text,
          locale,
          model: this.config.model,
          modelVersion: this.config.modelVersion,
        }),
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const body = (await response.json()) as { vector?: unknown };
      const vector = body.vector;
      if (
        !Array.isArray(vector) ||
        vector.length !== this.dimensions ||
        !vector.every((v) => typeof v === 'number' && Number.isFinite(v))
      ) {
        return null;
      }
      return vector as number[];
    } catch {
      return null; // Fail closed to lexical search.
    } finally {
      clearTimeout(timer);
    }
  }
}

export function loadQueryEmbedder(
  env: NodeJS.ProcessEnv = process.env,
): QueryEmbedder {
  const url = env.SEARCH_EMBEDDING_URL?.trim();
  if (!url) return new NullQueryEmbedder();
  return new HttpQueryEmbedder({
    url,
    model: env.SEARCH_EMBEDDING_MODEL ?? 'unknown',
    modelVersion: env.SEARCH_EMBEDDING_MODEL_VERSION ?? 'unknown',
    dimensions: 1024,
    ...(env.SEARCH_EMBEDDING_TIMEOUT_MS
      ? { timeoutMs: Number(env.SEARCH_EMBEDDING_TIMEOUT_MS) }
      : {}),
  });
}
