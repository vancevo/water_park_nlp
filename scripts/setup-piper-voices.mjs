#!/usr/bin/env node
// Download pinned Piper voices, verify them and write config/tts-voices.json
// with real checksums. Run on your own machine (needs network to HuggingFace):
//   npm run tts:setup-voices
//
// It never commits large model files — only the manifest (with checksums) is
// tracked. Voice .onnx files land in config/piper-voices/ (gitignored).

import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Console } from 'node:console';
import process from 'node:process';

/* global fetch */

const logger = new Console({ stdout: process.stdout, stderr: process.stderr });

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const templatePath = resolve(repoRoot, 'config/tts-voices.example.json');
const outputPath = resolve(repoRoot, 'config/tts-voices.json');

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function download(url, destination) {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`download failed (${response.status}) for ${url}`);
  }
  await mkdir(dirname(destination), { recursive: true });
  await new Promise((resolveWrite, reject) => {
    const file = createWriteStream(destination);
    Readable.fromWeb(response.body).pipe(file);
    file.on('finish', resolveWrite);
    file.on('error', reject);
  });
}

async function sha256(path) {
  const hash = createHash('sha256');
  hash.update(await readFile(path));
  return hash.digest('hex');
}

async function main() {
  // Start from an existing manifest if present, else the committed template.
  const source = (await exists(outputPath)) ? outputPath : templatePath;
  const manifest = JSON.parse(await readFile(source, 'utf8'));

  for (const voice of manifest.voices) {
    if (!voice.license || String(voice.license).includes('<')) {
      throw new Error(
        `Set a real license for voice "${voice.voiceId}" (check its MODEL_CARD) before running setup.`,
      );
    }
    const onnxPath = resolve(repoRoot, voice.modelPath);
    const jsonUrl = `${voice.sourceUrl}.json`;
    const jsonPath = `${onnxPath}.json`;

    if (!(await exists(onnxPath))) {
      logger.log(`Downloading ${voice.voiceId} model...`);
      await download(voice.sourceUrl, onnxPath);
    }
    if (!(await exists(jsonPath))) {
      logger.log(`Downloading ${voice.voiceId} config...`);
      await download(jsonUrl, jsonPath);
    }

    voice.checksum = await sha256(onnxPath);
    logger.log(`  ${voice.voiceId}: sha256=${voice.checksum}`);
  }

  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  logger.log(`\nWrote ${outputPath}`);
  logger.log(
    'Review the licenses and checksums, then commit config/tts-voices.json.',
  );
}

main().catch((error) => {
  logger.error(`setup-piper-voices failed: ${error.message}`);
  process.exitCode = 1;
});
