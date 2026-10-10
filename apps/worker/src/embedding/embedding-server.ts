import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Out-of-process text embedding service (C06 / ADR 0012 amendment).
 *
 * The API never runs a model: it POSTs the query to this service
 * (`HttpQueryEmbedder`), and the indexer embeds POI documents through it
 * (`HttpEmbeddingProvider`), so queries and documents always use the SAME
 * model/version. The model itself is injected (`TextEmbeddingModel`); the
 * default runtime is `tools/embedding-runtime/server.mjs` (free, local
 * BAAI/bge-m3 via transformers.js).
 *
 * Endpoints:
 * - `GET  /healthz`      → `{ status: loading|ready|failed, model, modelVersion, dimensions }`
 * - `POST /embed`        `{ text, model?, modelVersion? }` → `{ vector }` (API contract)
 * - `POST /embed/batch`  `{ texts, model?, modelVersion? }` → `{ vectors }`
 *
 * A request naming another model/version is refused (409) so mismatched
 * vectors are never compared; while the model loads it answers 503 and the API
 * falls back to lexical search. Text is never logged.
 */

export interface TextEmbeddingModel {
  readonly model: string;
  readonly modelVersion: string;
  readonly dimensions: number;
  embed(texts: readonly string[]): Promise<number[][]>;
}

export interface EmbeddingServerOptions {
  /** Most texts accepted in one batch request. */
  maxBatch?: number;
  /** Longest accepted text, in characters. */
  maxChars?: number;
  /** Request body cap in bytes. */
  maxBodyBytes?: number;
  log?: (line: string) => void;
}

type Status = 'loading' | 'ready' | 'failed';

export interface EmbeddingServerHandle {
  readonly server: Server;
  status(): Status;
  /** Resolves when the model is loaded (rejects if loading failed). */
  ready: Promise<void>;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

async function readJson(
  req: IncomingMessage,
  maxBytes: number,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > maxBytes) throw new HttpError(413, 'BODY_TOO_LARGE');
    chunks.push(chunk as Buffer);
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
      throw new Error('not an object');
    return parsed as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'INVALID_JSON');
  }
}

/**
 * Starts loading the model immediately and serves requests on the returned
 * server (call `server.listen`). Requests during loading get 503.
 */
export function createEmbeddingServer(
  loadModel: () => Promise<TextEmbeddingModel>,
  options: EmbeddingServerOptions = {},
): EmbeddingServerHandle {
  const maxBatch = options.maxBatch ?? 64;
  const maxChars = options.maxChars ?? 4000;
  const maxBodyBytes = options.maxBodyBytes ?? 1_000_000;
  const log = options.log ?? (() => undefined);

  let status: Status = 'loading';
  let model: TextEmbeddingModel | null = null;
  const ready = loadModel().then(
    (loaded) => {
      model = loaded;
      status = 'ready';
      log(
        `embedding server: ${loaded.model}@${loaded.modelVersion} ready (${loaded.dimensions} dims)`,
      );
    },
    (error: Error) => {
      status = 'failed';
      log(`embedding server: model failed to load (${error.name})`);
      throw error;
    },
  );
  ready.catch(() => undefined);

  const checkTexts = (texts: unknown): string[] => {
    if (
      !Array.isArray(texts) ||
      texts.length === 0 ||
      texts.length > maxBatch ||
      !texts.every((t) => typeof t === 'string')
    )
      throw new HttpError(400, 'INVALID_TEXTS');
    const list = texts as string[];
    if (list.some((t) => t.trim() === '' || t.length > maxChars))
      throw new HttpError(400, 'INVALID_TEXT_LENGTH');
    return list;
  };

  const checkModel = (
    body: Record<string, unknown>,
    loaded: TextEmbeddingModel,
  ) => {
    if (
      (body.model !== undefined && body.model !== loaded.model) ||
      (body.modelVersion !== undefined &&
        body.modelVersion !== loaded.modelVersion)
    )
      throw new HttpError(409, 'MODEL_MISMATCH');
  };

  const embed = async (texts: string[], loaded: TextEmbeddingModel) => {
    const vectors = await loaded.embed(texts);
    if (
      vectors.length !== texts.length ||
      vectors.some(
        (v) =>
          v.length !== loaded.dimensions || !v.every((x) => Number.isFinite(x)),
      )
    )
      throw new HttpError(500, 'BAD_MODEL_OUTPUT');
    return vectors;
  };

  const server = createServer((req, res) => {
    void (async () => {
      const path = (req.url ?? '/').split('?')[0];
      try {
        if (path === '/healthz' && req.method === 'GET') {
          const loaded = model as TextEmbeddingModel | null;
          send(res, status === 'ready' ? 200 : 503, {
            status,
            model: loaded?.model ?? null,
            modelVersion: loaded?.modelVersion ?? null,
            dimensions: loaded?.dimensions ?? null,
          });
          return;
        }
        if (path !== '/embed' && path !== '/embed/batch')
          throw new HttpError(404, 'NOT_FOUND');
        if (req.method !== 'POST')
          throw new HttpError(405, 'METHOD_NOT_ALLOWED');
        const loaded = model as TextEmbeddingModel | null;
        if (!loaded) throw new HttpError(503, `MODEL_${status.toUpperCase()}`);
        const body = await readJson(req, maxBodyBytes);
        checkModel(body, loaded);
        if (path === '/embed') {
          const [vector] = await embed(checkTexts([body.text]), loaded);
          send(res, 200, { vector });
        } else {
          send(res, 200, {
            vectors: await embed(checkTexts(body.texts), loaded),
          });
        }
      } catch (error) {
        const http =
          error instanceof HttpError
            ? error
            : new HttpError(500, 'EMBEDDING_FAILED');
        if (http.status >= 500) log(`embedding server: ${http.code}`);
        send(res, http.status, { code: http.code });
      }
    })();
  });

  return { server, status: () => status, ready };
}

export async function listen(
  server: Server,
  port: number,
  host: string,
): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  return (server.address() as AddressInfo).port;
}
