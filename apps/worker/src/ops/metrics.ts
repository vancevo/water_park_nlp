/**
 * Minimal, dependency-free metrics registry (AI08). Counters, gauges and
 * histograms with a bounded label set, exportable as Prometheus text or JSON.
 *
 * Privacy: label VALUES are sanitized (single line, length-capped) and callers
 * only ever pass low-cardinality operational fields (status, provider, model,
 * version, stable error code). Never pass a transcript, prompt, query or raw
 * GPS as a metric or label — those never enter observability.
 */

export type Labels = Readonly<Record<string, string>>;

export const DEFAULT_LATENCY_BUCKETS_MS: readonly number[] = [
  50, 100, 250, 500, 1000, 2500, 5000, 10_000, 30_000, 60_000,
];

const MAX_LABEL_LEN = 120;

function sanitizeLabelValue(value: string): string {
  return value.replace(/[\n\r]/gu, ' ').slice(0, MAX_LABEL_LEN);
}

function seriesKey(name: string, labels: Labels): string {
  const parts = Object.keys(labels)
    .sort()
    .map((k) => `${k}=${labels[k]}`);
  return `${name}{${parts.join(',')}}`;
}

interface CounterSeries {
  name: string;
  labels: Labels;
  value: number;
}
interface GaugeSeries {
  name: string;
  labels: Labels;
  value: number;
}
interface HistogramSeries {
  name: string;
  labels: Labels;
  buckets: readonly number[];
  counts: number[];
  sum: number;
  count: number;
}

export interface MetricsSnapshot {
  counters: { name: string; labels: Labels; value: number }[];
  gauges: { name: string; labels: Labels; value: number }[];
  histograms: {
    name: string;
    labels: Labels;
    buckets: readonly number[];
    counts: readonly number[];
    sum: number;
    count: number;
  }[];
}

export class MetricsRegistry {
  private readonly counters = new Map<string, CounterSeries>();
  private readonly gauges = new Map<string, GaugeSeries>();
  private readonly histograms = new Map<string, HistogramSeries>();

  private clean(labels: Labels): Labels {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(labels)) {
      out[k] = sanitizeLabelValue(String(v));
    }
    return out;
  }

  incrementCounter(name: string, labels: Labels = {}, by = 1): void {
    const safe = this.clean(labels);
    const key = seriesKey(name, safe);
    const existing = this.counters.get(key);
    if (existing) existing.value += by;
    else this.counters.set(key, { name, labels: safe, value: by });
  }

  setGauge(name: string, value: number, labels: Labels = {}): void {
    const safe = this.clean(labels);
    this.gauges.set(seriesKey(name, safe), { name, labels: safe, value });
  }

  observeHistogram(
    name: string,
    value: number,
    labels: Labels = {},
    buckets: readonly number[] = DEFAULT_LATENCY_BUCKETS_MS,
  ): void {
    const safe = this.clean(labels);
    const key = seriesKey(name, safe);
    let series = this.histograms.get(key);
    if (!series) {
      series = {
        name,
        labels: safe,
        buckets,
        counts: buckets.map(() => 0),
        sum: 0,
        count: 0,
      };
      this.histograms.set(key, series);
    }
    series.sum += value;
    series.count += 1;
    for (let i = 0; i < series.buckets.length; i += 1) {
      if (value <= series.buckets[i]!) series.counts[i]! += 1;
    }
  }

  snapshot(): MetricsSnapshot {
    return {
      counters: [...this.counters.values()].map((c) => ({ ...c })),
      gauges: [...this.gauges.values()].map((g) => ({ ...g })),
      histograms: [...this.histograms.values()].map((h) => ({
        ...h,
        counts: [...h.counts],
      })),
    };
  }

  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
  }

  /** Prometheus text exposition (v0.0.4). Stable ordering for diff-friendliness. */
  toPrometheus(): string {
    const lines: string[] = [];
    const fmtLabels = (labels: Labels): string => {
      const parts = Object.keys(labels)
        .sort()
        .map((k) => `${k}="${labels[k]!.replace(/["\\]/gu, '_')}"`);
      return parts.length > 0 ? `{${parts.join(',')}}` : '';
    };
    for (const c of [...this.counters.values()].sort(byName)) {
      lines.push(`${c.name}${fmtLabels(c.labels)} ${c.value}`);
    }
    for (const g of [...this.gauges.values()].sort(byName)) {
      lines.push(`${g.name}${fmtLabels(g.labels)} ${g.value}`);
    }
    for (const h of [...this.histograms.values()].sort(byName)) {
      let cumulative = 0;
      for (let i = 0; i < h.buckets.length; i += 1) {
        cumulative = h.counts[i]!;
        const le = { ...h.labels, le: String(h.buckets[i]) };
        lines.push(`${h.name}_bucket${fmtLabels(le)} ${cumulative}`);
      }
      const inf = { ...h.labels, le: '+Inf' };
      lines.push(`${h.name}_bucket${fmtLabels(inf)} ${h.count}`);
      lines.push(`${h.name}_sum${fmtLabels(h.labels)} ${h.sum}`);
      lines.push(`${h.name}_count${fmtLabels(h.labels)} ${h.count}`);
    }
    return `${lines.join('\n')}\n`;
  }
}

function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name);
}
