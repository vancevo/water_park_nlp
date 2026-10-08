import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { BenchmarkSentence } from '../piper/tts-benchmark.js';
import {
  buildBenchmarkProviders,
  loadBenchmarkProvidersManifest,
} from './benchmark-providers-manifest.js';
import {
  runProviderComparison,
  type BenchmarkThresholds,
} from './provider-benchmark.js';
import { validateProviderComparisonReport } from './provider-benchmark-report.js';

/**
 * Multi-provider comparison CLI (AI05). Run on your own machine after filling
 * config/tts-benchmark-providers.json (copy the .example.json and pin each
 * engine's version/license/command per its model card):
 *   npm run benchmark:providers --workspace @damsen/worker
 * Set TTS_BENCHMARK_INCLUDE_GPU=1 to also run GPU-class candidates (MOSS-TTS).
 *
 * Writes config/tts-provider-benchmark-report.json. The report holds only
 * sentence ids, input hashes, timings and stable error codes — never transcript
 * text or audio bytes.
 */
async function main(): Promise<void> {
  const cwd = process.cwd();
  const manifest = loadBenchmarkProvidersManifest({ cwd });
  const includeGpu = process.env.TTS_BENCHMARK_INCLUDE_GPU === '1';
  const candidates = buildBenchmarkProviders(manifest, { includeGpu });

  const sentences = (
    JSON.parse(
      readFileSync(resolve(cwd, 'config/tts-benchmark-sentences.json'), 'utf8'),
    ) as { sentences: BenchmarkSentence[] }
  ).sentences;

  const thresholds = JSON.parse(
    readFileSync(resolve(cwd, 'config/tts-benchmark-thresholds.json'), 'utf8'),
  ) as BenchmarkThresholds;

  const report = await runProviderComparison(candidates, sentences, {
    thresholds,
  });

  const violations = validateProviderComparisonReport(report);
  if (violations.length > 0) {
    throw new Error(`report failed validation:\n- ${violations.join('\n- ')}`);
  }

  for (const p of report.providers) {
    const verdict = p.passed ? 'PASS' : `FAIL (${p.violations.join('; ')})`;
    process.stdout.write(
      `${p.provider}@${p.modelVersion} [${p.hardwareClass}] ${p.locale}: ` +
        `ok=${p.ok}/${p.count} p95=${p.p95GenerationMs}ms RTF=${p.meanRealTimeFactor?.toFixed(3)} ${verdict}\n`,
    );
  }
  for (const r of report.recommendationsByLocale) {
    process.stdout.write(
      `recommend[${r.locale}] = ${r.recommendedProvider ?? '(none)'} — ${r.rationale}\n`,
    );
  }

  const outPath = resolve(cwd, 'config/tts-provider-benchmark-report.json');
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`\nWrote ${outPath}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `provider benchmark failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
