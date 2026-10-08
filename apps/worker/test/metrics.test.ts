import { describe, expect, it } from 'vitest';

import { MetricsRegistry } from '../src/ops/metrics.js';

describe('MetricsRegistry', () => {
  it('accumulates counters per label set', () => {
    const r = new MetricsRegistry();
    r.incrementCounter('jobs_total', { status: 'queued' });
    r.incrementCounter('jobs_total', { status: 'queued' });
    r.incrementCounter('jobs_total', { status: 'failed' });
    const counters = r.snapshot().counters;
    expect(counters).toContainEqual({
      name: 'jobs_total',
      labels: { status: 'queued' },
      value: 2,
    });
    expect(counters).toContainEqual({
      name: 'jobs_total',
      labels: { status: 'failed' },
      value: 1,
    });
  });

  it('sets gauges (last write wins)', () => {
    const r = new MetricsRegistry();
    r.setGauge('queue_depth', 5);
    r.setGauge('queue_depth', 2);
    expect(r.snapshot().gauges[0]).toMatchObject({ value: 2 });
  });

  it('observes histograms with cumulative buckets, sum and count', () => {
    const r = new MetricsRegistry();
    r.observeHistogram('latency', 80, {}, [100, 1000]);
    r.observeHistogram('latency', 900, {}, [100, 1000]);
    const h = r.snapshot().histograms[0]!;
    expect(h.count).toBe(2);
    expect(h.sum).toBe(980);
    expect(h.counts).toEqual([1, 2]); // ≤100: one; ≤1000: both
  });

  it('exposes Prometheus text including _bucket/_sum/_count', () => {
    const r = new MetricsRegistry();
    r.incrementCounter('jobs_total', { status: 'succeeded' });
    r.observeHistogram('latency', 50, { provider: 'piper' }, [100]);
    const text = r.toPrometheus();
    expect(text).toContain('jobs_total{status="succeeded"} 1');
    expect(text).toContain('latency_bucket{le="100",provider="piper"} 1');
    expect(text).toContain('latency_bucket{le="+Inf",provider="piper"} 1');
    expect(text).toContain('latency_sum{provider="piper"} 50');
    expect(text).toContain('latency_count{provider="piper"} 1');
  });

  it('sanitizes label values (single line, length-capped)', () => {
    const r = new MetricsRegistry();
    r.incrementCounter('x', { note: `line1\nline2${'a'.repeat(200)}` });
    const value = r.snapshot().counters[0]!.labels.note!;
    expect(value).not.toContain('\n');
    expect(value.length).toBeLessThanOrEqual(120);
  });
});
