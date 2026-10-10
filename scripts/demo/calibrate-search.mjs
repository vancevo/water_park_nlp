/* global fetch, URLSearchParams */
// Search calibration + evaluation for the demo (C06, ADR 0012 amendment §4).
//
// calibrateSimilarityFloor(): embeds the 50 evaluation queries with the
// running embedding service, compares them with the stored POI vectors and
// sets the vector-expansion floor just above the highest similarity any
// expected-zero ("nonsense") query reaches — so semantic search never invents
// results for them — then estimates which semantic queries it will now catch.
//
// evaluateSearch(): runs the 50 queries against the live API and computes
// Recall@10 / MRR (same definitions as data/search-evaluation/evaluate.py).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import pg from 'pg';

import { repoRoot } from './lib.mjs';

const MARGIN = 0.02;
const MIN_FLOOR = 0.35;
const MAX_FLOOR = 0.9;

function loadQueries() {
  const dataset = JSON.parse(
    readFileSync(join(repoRoot, 'data/search-evaluation/queries.json'), 'utf8'),
  );
  return dataset.queries;
}

const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);

async function embedAll(embeddingUrl, texts, model, modelVersion) {
  const vectors = [];
  for (let i = 0; i < texts.length; i += 16) {
    const res = await fetch(embeddingUrl.replace(/\/embed$/u, '/embed/batch'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        texts: texts.slice(i, i + 16),
        model,
        modelVersion,
      }),
    });
    if (!res.ok) throw new Error(`embedding service answered ${res.status}`);
    vectors.push(...(await res.json()).vectors);
  }
  return vectors;
}

export async function calibrateSimilarityFloor({
  databaseUrl,
  embeddingUrl,
  model,
  modelVersion,
}) {
  const queries = loadQueries();
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  let rows;
  try {
    ({ rows } = await pool.query(
      `SELECT entity_id::text AS id, locale, embedding::text AS embedding
       FROM semantic_embeddings
       WHERE entity_type = 'poi' AND model = $1 AND model_version = $2`,
      [model, modelVersion],
    ));
  } finally {
    await pool.end();
  }
  if (rows.length === 0) throw new Error('no POI embeddings stored yet');
  const docs = rows.map((r) => ({
    id: r.id,
    locale: r.locale,
    vector: JSON.parse(r.embedding),
  }));
  const vectors = await embedAll(
    embeddingUrl,
    queries.map((q) => q.text),
    model,
    modelVersion,
  );
  const scored = queries.map((q, i) => {
    const sims = docs
      .filter((d) => d.locale === q.locale)
      .map((d) => ({ id: d.id, sim: dot(vectors[i], d.vector) }))
      .sort((a, b) => b.sim - a.sim);
    return { query: q, sims };
  });

  const noise = Math.max(
    ...scored
      .filter((s) => s.query.relevant.length === 0)
      .map((s) => s.sims[0]?.sim ?? 0),
  );
  // If even nonsense queries look this similar, the model cannot separate
  // them: keep hybrid re-ranking but switch the expansion off.
  const expand = noise + MARGIN <= MAX_FLOOR;
  const floor = expand
    ? Math.max(MIN_FLOOR, Math.ceil((noise + MARGIN) * 100) / 100)
    : MAX_FLOOR;
  const semantic = scored.filter(
    (s) => s.query.case_type === 'semantic_intent',
  );
  const reachable = !expand
    ? 0
    : semantic.filter((s) =>
        s.query.relevant.some((r) =>
          s.sims.some((x) => x.id === r.poi_id && x.sim >= floor),
        ),
      ).length;
  return {
    expand,
    floor,
    noise: Number(noise.toFixed(4)),
    semanticReachable: reachable,
    semanticTotal: semantic.length,
  };
}

export async function evaluateSearch(apiUrl) {
  const queries = loadQueries();
  let recall = 0;
  let mrr = 0;
  let judged = 0;
  let zeroOk = 0;
  let zeroTotal = 0;
  for (const q of queries) {
    const params = new URLSearchParams({
      q: q.text,
      locale: q.locale,
      limit: '10',
    });
    const res = await fetch(`${apiUrl}/v1/search?${params}`);
    if (!res.ok) throw new Error(`search answered ${res.status}`);
    const ids = (await res.json()).items.map((item) => item.id);
    const relevant = new Set(q.relevant.map((r) => r.poi_id));
    if (relevant.size === 0) {
      zeroTotal += 1;
      if (ids.length === 0) zeroOk += 1;
      continue;
    }
    judged += 1;
    recall += ids.filter((id) => relevant.has(id)).length / relevant.size;
    const first = ids.findIndex((id) => relevant.has(id));
    mrr += first === -1 ? 0 : 1 / (first + 1);
  }
  return {
    recallAt10: Number((recall / judged).toFixed(3)),
    mrr: Number((mrr / judged).toFixed(3)),
    expectedZeroAccuracy: Number((zeroOk / zeroTotal).toFixed(2)),
  };
}
