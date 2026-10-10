import { afterEach, describe, expect, it } from 'vitest';

import { MetricsRegistry } from '../src/ops/metrics.js';
import {
  MetricsServerConfigError,
  PROMETHEUS_CONTENT_TYPE,
  loadMetricsServerConfig,
  startMetricsServer,
  type RunningMetricsServer,
} from '../src/ops/metrics-server.js';
import { TtsMetrics } from '../src/ops/tts-metrics.js';

describe('C07: worker metrics scrape endpoint', () => {
  let running: RunningMetricsServer | undefined;
  afterEach(async () => {
    await running?.close();
    running = undefined;
  });

  async function start(registry: MetricsRegistry) {
    running = await startMetricsServer(registry, {
      host: '127.0.0.1',
      port: 0,
    });
    return `http://127.0.0.1:${running.port}`;
  }

  it('serves the registry as Prometheus text on GET /metrics', async () => {
    const registry = new MetricsRegistry();
    const metrics = new TtsMetrics(registry);
    const job = { provider: 'piper', model: 'vi', modelVersion: 'v1' };
    metrics.recordJobTransition('succeeded', job);
    metrics.recordGenerationDuration(320, job);
    metrics.setQueueDepth(3, { status: 'queued' });
    const base = await start(registry);

    const res = await fetch(`${base}/metrics`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe(PROMETHEUS_CONTENT_TYPE);
    const body = await res.text();
    expect(body).toContain(
      'tts_jobs_total{model="vi",model_version="v1",provider="piper",status="succeeded"} 1',
    );
    expect(body).toContain('tts_queue_depth{status="queued"} 3');
    expect(body).toContain(
      'tts_generation_duration_ms_count{model="vi",provider="piper"} 1',
    );
  });

  it('reflects new observations on every scrape (no caching)', async () => {
    const registry = new MetricsRegistry();
    const base = await start(registry);
    expect(await (await fetch(`${base}/metrics`)).text()).toBe('\n');
    registry.incrementCounter('tts_job_retries_total', {
      provider: 'piper',
      model: 'vi',
    });
    expect(await (await fetch(`${base}/metrics`)).text()).toContain(
      'tts_job_retries_total{model="vi",provider="piper"} 1',
    );
  });

  it('answers /healthz, 404 for other paths and 405 for writes', async () => {
    const base = await start(new MetricsRegistry());
    const health = await fetch(`${base}/healthz`);
    expect(health.status).toBe(200);
    expect(await health.text()).toBe('ok\n');
    expect((await fetch(`${base}/`)).status).toBe(404);
    expect((await fetch(`${base}/metrics/../admin`)).status).toBe(404);
    const post = await fetch(`${base}/metrics`, { method: 'POST' });
    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET, HEAD');
  });

  it('rejects a port that is already in use instead of hanging', async () => {
    const registry = new MetricsRegistry();
    await start(registry);
    await expect(
      startMetricsServer(registry, { host: '127.0.0.1', port: running!.port }),
    ).rejects.toMatchObject({ code: 'EADDRINUSE' });
  });
});

describe('C07: metrics endpoint config', () => {
  it('defaults to enabled on loopback port 9464', () => {
    expect(loadMetricsServerConfig({})).toEqual({
      enabled: true,
      host: '127.0.0.1',
      port: 9464,
    });
  });

  it('reads host/port/enabled from env', () => {
    expect(
      loadMetricsServerConfig({
        WORKER_METRICS_ENABLED: 'false',
        WORKER_METRICS_HOST: '0.0.0.0',
        WORKER_METRICS_PORT: '9100',
      }),
    ).toEqual({ enabled: false, host: '0.0.0.0', port: 9100 });
  });

  it('fails fast on an invalid port or flag', () => {
    expect(() =>
      loadMetricsServerConfig({ WORKER_METRICS_PORT: '70000' }),
    ).toThrow(MetricsServerConfigError);
    expect(() =>
      loadMetricsServerConfig({ WORKER_METRICS_PORT: 'abc' }),
    ).toThrow(MetricsServerConfigError);
    expect(() =>
      loadMetricsServerConfig({ WORKER_METRICS_ENABLED: 'yes' }),
    ).toThrow(MetricsServerConfigError);
  });
});
