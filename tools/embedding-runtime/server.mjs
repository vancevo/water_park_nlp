/* global console */
// Free, local embedding service for search (C06): BAAI/bge-m3 (MIT licence,
// multilingual incl. Vietnamese, 1024 dims) run on the CPU with
// transformers.js + onnxruntime — no API key, no paid service.
//
//   npm install --prefix tools/embedding-runtime   (once; ~200 MB runtime)
//   node tools/embedding-runtime/server.mjs        (first run downloads ~570 MB)
//
// Env:
//   EMBEDDING_PORT / EMBEDDING_HOST   listen address (8091 / 127.0.0.1)
//   EMBEDDING_MODEL_ID                Hugging Face model id (Xenova/bge-m3)
//   EMBEDDING_DTYPE                   q8 (model_quantized.onnx, default) | fp32 …
//   EMBEDDING_POOLING                 cls (bge-m3) | mean
//   EMBEDDING_CACHE_DIR               where models are stored (<repo>/.demo/models)
//   EMBEDDING_LOCAL_MODEL_PATH        load only from this folder (offline/tests)
//
// The HTTP protocol lives in apps/worker/src/embedding/embedding-server.ts
// (build the worker first). The model name/version reported here must match
// the API's SEARCH_EMBEDDING_MODEL / SEARCH_EMBEDDING_MODEL_VERSION.

import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { env, pipeline } from '@huggingface/transformers';

import {
  createEmbeddingServer,
  listen,
} from '../../apps/worker/dist/embedding/embedding-server.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');

const modelId = process.env.EMBEDDING_MODEL_ID?.trim() || 'Xenova/bge-m3';
const dtype = process.env.EMBEDDING_DTYPE?.trim() || 'q8';
const pooling = process.env.EMBEDDING_POOLING?.trim() || 'cls';
const port = Number(process.env.EMBEDDING_PORT ?? 8091);
const host = process.env.EMBEDDING_HOST?.trim() || '127.0.0.1';

env.cacheDir =
  process.env.EMBEDDING_CACHE_DIR?.trim() || resolve(repoRoot, '.demo/models');
const localPath = process.env.EMBEDDING_LOCAL_MODEL_PATH?.trim();
if (localPath) {
  env.localModelPath = localPath;
  env.allowRemoteModels = false;
}

/** Public name/version used to label stored vectors and match queries. */
export const MODEL_NAME = 'BAAI/bge-m3';
export const MODEL_VERSION = `${modelId}@${dtype}`;

async function loadModel() {
  console.log(
    `embedding server: loading ${modelId} (${dtype}) — the first run downloads the model, please wait…`,
  );
  const extractor = await pipeline('feature-extraction', modelId, { dtype });
  return {
    model: MODEL_NAME,
    modelVersion: MODEL_VERSION,
    dimensions: 1024,
    async embed(texts) {
      const output = await extractor([...texts], {
        pooling,
        normalize: true,
      });
      return output.tolist();
    },
  };
}

const { server, ready } = createEmbeddingServer(loadModel, {
  log: (line) => console.log(line),
});
const bound = await listen(server, port, host);
console.log(`embedding server: listening on http://${host}:${bound}`);

if (process.argv.includes('--warmup')) {
  // Download + load the model, then exit (used by the demo setup).
  try {
    await ready;
    console.log('embedding server: model ready');
    process.exitCode = 0;
  } catch (error) {
    console.error(`embedding server: ${error?.message ?? error}`);
    process.exitCode = 1;
  }
  server.close();
} else {
  ready.catch(() => {
    console.error(
      'embedding server: model failed to load; search stays lexical',
    );
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => server.close(() => process.exit(0)));
  }
}
