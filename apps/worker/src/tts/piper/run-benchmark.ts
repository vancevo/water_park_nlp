import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildPiperProvider, loadPiperVoiceManifest } from './piper-voices.js';
import { runTtsBenchmark, type BenchmarkSentence } from './tts-benchmark.js';

/**
 * CPU benchmark CLI for the Piper baseline. Run on your own machine after
 * `npm run tts:setup-voices` (needs the piper binary on PATH or in the manifest):
 *   npm run benchmark --workspace @damsen/worker
 *
 * Writes config/tts-benchmark-report.json. The report contains only sentence ids,
 * timings and sizes — never transcript text or audio.
 */
async function main(): Promise<void> {
  const cwd = process.cwd();
  const manifest = loadPiperVoiceManifest({ cwd });
  const sentencesRaw = JSON.parse(
    readFileSync(resolve(cwd, 'config/tts-benchmark-sentences.json'), 'utf8'),
  ) as { sentences: BenchmarkSentence[] };

  const reports = [];
  for (const voice of manifest.voices) {
    if (!voice.enabled) continue;
    const provider = buildPiperProvider(manifest, voice);
    console.log(`Benchmarking ${voice.voiceId} (${voice.locale})...`);
    const report = await runTtsBenchmark(provider, sentencesRaw.sentences, {
      voiceId: voice.voiceId,
    });
    console.log(
      `  ok=${report.ok}/${report.count}  p50=${report.p50GenerationMs}ms  ` +
        `p95=${report.p95GenerationMs}ms  RTF=${report.meanRealTimeFactor?.toFixed(3)}`,
    );
    reports.push(report);
  }

  const outPath = resolve(cwd, 'config/tts-benchmark-report.json');
  writeFileSync(outPath, `${JSON.stringify({ reports }, null, 2)}\n`, 'utf8');
  console.log(`\nWrote ${outPath}`);
}

main().catch((error: unknown) => {
  console.error(
    `benchmark failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
