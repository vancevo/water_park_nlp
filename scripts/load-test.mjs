/* global console, fetch, AbortSignal, performance */
// Load test for the public visitor API (C07 / AI08). Dependency-free.
//
// Drives the read paths a visitor hits on a busy day — POI list, search,
// narration locale catalog, POI narration and walking routes — with a fixed
// number of concurrent virtual users for a fixed duration, then checks the
// latency and error budget. Exit code 1 when a threshold is broken, so it can
// gate a release.
//
// Usage (API already running):
//   npm run load:api
//   LOAD_BASE_URL=http://127.0.0.1:3000 LOAD_DURATION_S=60 LOAD_CONCURRENCY=50 npm run load:api
//
// Env:
//   LOAD_BASE_URL       API base URL                        (http://127.0.0.1:3000)
//   LOAD_DURATION_S     test duration in seconds            (30)
//   LOAD_CONCURRENCY    concurrent virtual users            (20)
//   LOAD_P95_MS         p95 latency budget per scenario     (500)
//   LOAD_MAX_ERROR_RATE max share of failed requests        (0.01)
//   LOAD_TIMEOUT_MS     per-request timeout                 (5000)
//   LOAD_REPORT         optional path to write a JSON report
//
// Privacy: the script only sends synthetic coordinates and fixed queries; it
// never logs response bodies.

import { writeFile } from 'node:fs/promises';
import process from 'node:process';

const env = process.env;
const num = (name, fallback) => {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    console.error(`${name} must be a positive number`);
    process.exit(2);
  }
  return n;
};

const baseUrl = (env.LOAD_BASE_URL ?? 'http://127.0.0.1:3000').replace(
  /\/+$/u,
  '',
);
const durationMs = num('LOAD_DURATION_S', 30) * 1000;
const concurrency = Math.floor(num('LOAD_CONCURRENCY', 20));
const p95BudgetMs = num('LOAD_P95_MS', 500);
const maxErrorRate = num('LOAD_MAX_ERROR_RATE', 0.01);
const timeoutMs = num('LOAD_TIMEOUT_MS', 5000);

const SEARCH_QUERIES = [
  'tro choi nuoc',
  'nhà hàng',
  'restroom',
  'cổng chính',
  'kids',
  'ăn uống gần hồ',
  'first aid',
  'show',
];

async function discoverPois() {
  const res = await fetch(`${baseUrl}/v1/pois?locale=vi`, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`GET /v1/pois returned ${res.status}`);
  const body = await res.json();
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) throw new Error('no published POI to load-test');
  return items;
}

function pick(list, i) {
  return list[i % list.length];
}

function buildScenarios(pois) {
  // Weights approximate a visitor session: browse > search > narration > route.
  return [
    {
      name: 'list_pois',
      weight: 3,
      request: () => ({ path: '/v1/pois?locale=vi' }),
    },
    {
      name: 'search',
      weight: 3,
      request: (i) => ({
        path: `/v1/search?locale=vi&q=${encodeURIComponent(pick(SEARCH_QUERIES, i))}`,
      }),
    },
    {
      name: 'narration_locales',
      weight: 1,
      request: () => ({ path: '/v1/narration-locales' }),
    },
    {
      name: 'poi_narration',
      weight: 2,
      // 404 is a valid answer when a locale has no published narration yet.
      okStatuses: [200, 404],
      request: (i) => ({
        path: `/v1/pois/${pick(pois, i).id}/narration?locale=vi`,
      }),
    },
    {
      name: 'route',
      weight: 2,
      // 422 = origin outside the walkway graph; still a handled answer.
      okStatuses: [201, 422],
      request: (i) => {
        const from = pick(pois, i + 1).location;
        return {
          path: '/v1/routes',
          method: 'POST',
          body: {
            from: {
              lat: from.latitude + 0.00005,
              lng: from.longitude + 0.00005,
            },
            poiId: pick(pois, i).id,
          },
        };
      },
    },
  ];
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.ceil((p / 100) * sorted.length) - 1,
  );
  return sorted[Math.max(0, idx)];
}

async function main() {
  const pois = await discoverPois();
  const scenarios = buildScenarios(pois);
  const wheel = scenarios.flatMap((s) => Array(s.weight).fill(s));
  const stats = new Map(
    scenarios.map((s) => [
      s.name,
      { latencies: [], ok: 0, failed: 0, statuses: {} },
    ]),
  );

  const deadline = Date.now() + durationMs;
  let seq = 0;
  async function virtualUser() {
    while (Date.now() < deadline) {
      const i = seq++;
      const scenario = wheel[i % wheel.length];
      const { path, method = 'GET', body } = scenario.request(i);
      const s = stats.get(scenario.name);
      const started = performance.now();
      let status = 'error';
      try {
        const res = await fetch(`${baseUrl}${path}`, {
          method,
          headers: body ? { 'content-type': 'application/json' } : undefined,
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(timeoutMs),
        });
        await res.arrayBuffer();
        status = String(res.status);
        const okStatuses = scenario.okStatuses ?? [200];
        if (okStatuses.includes(res.status)) s.ok += 1;
        else s.failed += 1;
      } catch (error) {
        status = error?.name === 'TimeoutError' ? 'timeout' : 'error';
        s.failed += 1;
      }
      s.latencies.push(performance.now() - started);
      s.statuses[status] = (s.statuses[status] ?? 0) + 1;
    }
  }

  console.log(
    `load test: ${baseUrl} · ${concurrency} users · ${durationMs / 1000}s · ${pois.length} POIs`,
  );
  const startedAt = Date.now();
  await Promise.all(Array.from({ length: concurrency }, () => virtualUser()));
  const elapsedS = (Date.now() - startedAt) / 1000;

  const rows = [];
  let total = 0;
  let failed = 0;
  const breaches = [];
  for (const [name, s] of stats) {
    const sorted = [...s.latencies].sort((a, b) => a - b);
    const count = s.ok + s.failed;
    total += count;
    failed += s.failed;
    const row = {
      scenario: name,
      requests: count,
      rps: Number((count / elapsedS).toFixed(1)),
      p50Ms: Math.round(percentile(sorted, 50)),
      p95Ms: Math.round(percentile(sorted, 95)),
      p99Ms: Math.round(percentile(sorted, 99)),
      errorRate: count ? Number((s.failed / count).toFixed(4)) : 0,
      statuses: s.statuses,
    };
    rows.push(row);
    if (count > 0 && row.p95Ms > p95BudgetMs)
      breaches.push(`${name}: p95 ${row.p95Ms} ms > ${p95BudgetMs} ms`);
  }
  const errorRate = total ? failed / total : 1;
  if (total === 0) breaches.push('no request completed');
  if (errorRate > maxErrorRate)
    breaches.push(
      `error rate ${(errorRate * 100).toFixed(2)}% > ${(maxErrorRate * 100).toFixed(2)}%`,
    );

  console.table(
    rows.map(({ statuses, ...r }) => ({
      ...r,
      statuses: Object.entries(statuses)
        .map(([k, v]) => `${k}:${v}`)
        .join(' '),
    })),
  );
  console.log(
    `total ${total} requests · ${(total / elapsedS).toFixed(1)} req/s · error rate ${(errorRate * 100).toFixed(2)}%`,
  );

  const report = {
    baseUrl,
    startedAt: new Date(startedAt).toISOString(),
    durationS: Number(elapsedS.toFixed(1)),
    concurrency,
    thresholds: { p95Ms: p95BudgetMs, maxErrorRate },
    totalRequests: total,
    errorRate: Number(errorRate.toFixed(4)),
    scenarios: rows,
    pass: breaches.length === 0,
    breaches,
  };
  if (env.LOAD_REPORT) {
    await writeFile(env.LOAD_REPORT, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`report: ${env.LOAD_REPORT}`);
  }
  if (breaches.length > 0) {
    console.error(`FAIL\n- ${breaches.join('\n- ')}`);
    process.exit(1);
  }
  console.log('PASS');
}

main().catch((error) => {
  console.error(`load test aborted: ${error.message}`);
  process.exit(2);
});
