/* global console, fetch */
import process from 'node:process';
import { performance } from 'node:perf_hooks';

const apiBase = (
  process.env.OPERATIONS_BENCHMARK_API_URL ?? 'http://127.0.0.1:3000'
).replace(/\/$/, '');
const email = process.env.OPERATIONS_BENCHMARK_ADMIN_EMAIL?.trim();
const password = process.env.OPERATIONS_BENCHMARK_ADMIN_PASSWORD;
const samples = Number(process.env.OPERATIONS_BENCHMARK_SAMPLES ?? 100);
const warmup = Number(process.env.OPERATIONS_BENCHMARK_WARMUP ?? 10);
const thresholdMs = Number(
  process.env.OPERATIONS_BENCHMARK_P95_THRESHOLD_MS ?? 1_000,
);

if (!email || !password) {
  console.error(
    'OPERATIONS_BENCHMARK_ADMIN_EMAIL and OPERATIONS_BENCHMARK_ADMIN_PASSWORD are required',
  );
  process.exit(2);
}
if (
  !Number.isInteger(samples) ||
  samples < 1 ||
  samples > 10_000 ||
  !Number.isInteger(warmup) ||
  warmup < 0 ||
  warmup > 1_000 ||
  !Number.isFinite(thresholdMs) ||
  thresholdMs <= 0 ||
  thresholdMs > 60_000
) {
  console.error(
    'samples must be 1..10000, warmup 0..1000 and p95 threshold 1..60000ms',
  );
  process.exit(2);
}

const percentile = (values, ratio) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[
    Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)
  ];
};

async function request(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  return response.json();
}

const session = await request('/v1/auth/login', {
  method: 'POST',
  body: { email, password },
});
if (typeof session.accessToken !== 'string') {
  console.error('Login response did not include an access token');
  process.exit(2);
}

const durations = [];
try {
  for (let index = 0; index < warmup + samples; index += 1) {
    const started = performance.now();
    const summary = await request('/v1/admin/dashboard/summary', {
      token: session.accessToken,
    });
    const duration = performance.now() - started;
    if (
      summary?.timezone !== 'Asia/Ho_Chi_Minh' ||
      typeof summary?.generatedAt !== 'string' ||
      typeof summary?.simulatedRevenue?.todayVnd !== 'number'
    ) {
      throw new Error('INVALID_DASHBOARD_SUMMARY');
    }
    if (index >= warmup) durations.push(duration);
  }

  const result = {
    samples,
    warmup,
    p50Ms: Math.round(percentile(durations, 0.5)),
    p95Ms: Math.round(percentile(durations, 0.95)),
    maxMs: Math.round(Math.max(...durations)),
    thresholdMs,
  };
  console.log(JSON.stringify(result));
  if (result.p95Ms >= thresholdMs) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Benchmark failed');
  process.exitCode = 2;
}
