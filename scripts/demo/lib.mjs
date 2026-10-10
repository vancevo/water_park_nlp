/* global console, fetch, setTimeout, AbortSignal */
// Shared helpers for the local demo runner (scripts/demo/demo.mjs).
// Cross-platform (Windows first): never uses a shell, so paths with spaces or
// Vietnamese characters are passed through untouched.

import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createWriteStream, existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const repoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../..',
);
export const demoDir = join(repoRoot, '.demo');
export const logDir = join(demoDir, 'logs');
export const isWindows = process.platform === 'win32';
export const composeFile = join(repoRoot, 'infra/docker/docker-compose.yml');

export const ADMIN_EMAIL = 'admin@damsen.local';
export const ADMIN_PASSWORD = 'DamSen-Demo-2026';
export const EMBEDDING_MODEL = 'BAAI/bge-m3';
export const EMBEDDING_MODEL_VERSION = 'Xenova/bge-m3@q8';

export const PORTS = {
  api: 3000,
  admin: 3001,
  visitor: 3002,
  embedding: 8091,
  workerMetrics: 9464,
  postgres: 64321,
  minio: 9000,
};

export const say = (line = '') => console.log(line);
export const step = (n, total, text) => say(`\n[${n}/${total}] ${text}`);
export const ok = (text) => say(`   ✓ ${text}`);
export const warn = (text) => say(`   ! ${text}`);

export class DemoError extends Error {}

/** npm without a shell: run npm-cli.js with this very node binary. */
export function npmCommand() {
  const candidates = [
    process.env.npm_execpath,
    join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
    join(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'),
  ].filter(Boolean);
  const cli = candidates.find((p) => p.endsWith('.js') && existsSync(p));
  if (cli) return { command: process.execPath, prefix: [cli] };
  // POSIX installs where npm is not next to node: its shim runs without a shell.
  if (!isWindows) return { command: 'npm', prefix: [] };
  throw new DemoError(
    'Không tìm thấy npm đi kèm Node.js — hãy cài lại Node.js 24.',
  );
}

/** Run a command to completion, streaming output to the console. */
export function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: { ...process.env, ...options.env },
      stdio: options.quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      windowsHide: true,
    });
    let output = '';
    child.stdout?.on('data', (d) => (output += d));
    child.stderr?.on('data', (d) => (output += d));
    child.on('error', (error) =>
      reject(new DemoError(`${options.label ?? command}: ${error.message}`)),
    );
    child.on('close', (code) => {
      if (code === 0) resolvePromise(output);
      else
        reject(
          new DemoError(
            `${options.label ?? command} lỗi (mã ${code}).${options.quiet ? `\n${output.slice(-1500)}` : ''}`,
          ),
        );
    });
  });
}

export function npm(args, options = {}) {
  const { command, prefix } = npmCommand();
  return run(command, [...prefix, ...args], {
    label: `npm ${args[0]}`,
    ...options,
  });
}

export function node(scriptArgs, options = {}) {
  return run(process.execPath, scriptArgs, options);
}

/** First Python ≥ 3.9 found (Windows launcher `py -3` first). */
export function findPython() {
  const candidates = isWindows
    ? [
        ['py', ['-3']],
        ['python', []],
        ['python3', []],
      ]
    : [
        ['python3', []],
        ['python', []],
      ];
  for (const [command, prefix] of candidates) {
    const out = spawnSync(
      command,
      [...prefix, '-c', 'import sys;print("%d.%d"%sys.version_info[:2])'],
      {
        encoding: 'utf8',
        windowsHide: true,
      },
    );
    if (out.status === 0) {
      const [major, minor] = out.stdout.trim().split('.').map(Number);
      if (major === 3 && minor >= 9)
        return { command, prefix, version: out.stdout.trim() };
    }
  }
  return null;
}

export function venvPath(...parts) {
  return join(demoDir, 'venv', ...parts);
}
export const venvPython = () =>
  isWindows ? venvPath('Scripts', 'python.exe') : venvPath('bin', 'python');
export const venvPiper = () =>
  isWindows ? venvPath('Scripts', 'piper.exe') : venvPath('bin', 'piper');

export function dockerAvailable() {
  const out = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  return out.status === 0 && out.stdout.trim() !== '';
}

export function docker(args, options = {}) {
  return run('docker', ['compose', '-f', composeFile, ...args], {
    label: 'docker compose',
    ...options,
  });
}

export async function waitFor(
  label,
  check,
  { timeoutMs = 120_000, intervalMs = 1500 } = {},
) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new DemoError(
    `${label} chưa sẵn sàng sau ${Math.round(timeoutMs / 1000)} giây${lastError ? ` (${lastError.message})` : ''}.`,
  );
}

export async function httpOk(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
  return res.ok;
}

export function portInUse(port, host = '127.0.0.1') {
  return new Promise((resolvePromise) => {
    const socket = createConnection({ port, host });
    socket.once('connect', () => {
      socket.destroy();
      resolvePromise(true);
    });
    socket.once('error', () => resolvePromise(false));
    socket.setTimeout(1000, () => {
      socket.destroy();
      resolvePromise(false);
    });
  });
}

// ---- demo.env: generated once, holds secrets + calibrated values ----------

const envFile = join(demoDir, 'demo.env');

export function readDemoEnv() {
  if (!existsSync(envFile)) return {};
  const values = {};
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/u)) {
    const match = /^([A-Z0-9_]+)=(.*)$/u.exec(line.trim());
    if (match) values[match[1]] = match[2];
  }
  return values;
}

export async function writeDemoEnv(values) {
  await mkdir(demoDir, { recursive: true });
  const lines = [
    '# Generated by scripts/demo/demo.mjs — local demo only, never commit.',
    ...Object.entries(values).map(([k, v]) => `${k}=${v}`),
  ];
  await writeFile(envFile, `${lines.join('\n')}\n`, 'utf8');
}

export async function ensureDemoEnv() {
  const current = readDemoEnv();
  const values = {
    ACCESS_TOKEN_SECRET:
      current.ACCESS_TOKEN_SECRET ?? randomBytes(32).toString('hex'),
    REFRESH_TOKEN_SECRET:
      current.REFRESH_TOKEN_SECRET ?? randomBytes(32).toString('hex'),
    SEARCH_HYBRID_MIN_SIMILARITY: current.SEARCH_HYBRID_MIN_SIMILARITY ?? '0.5',
    ...current,
  };
  await writeDemoEnv(values);
  return values;
}

/** Environment shared by the API, worker and helper scripts. */
export function serviceEnv(demoEnv = readDemoEnv()) {
  const external = process.env.DEMO_EXTERNAL_SERVICES === '1';
  return {
    NODE_ENV: 'development',
    DATABASE_URL: external
      ? process.env.DATABASE_URL
      : `postgresql://damsen:damsen_local_only@127.0.0.1:${PORTS.postgres}/damsen`,
    REDIS_URL: 'redis://127.0.0.1:6379',
    S3_ENDPOINT: external
      ? process.env.S3_ENDPOINT
      : `http://127.0.0.1:${PORTS.minio}`,
    S3_ENABLED: 'true',
    S3_REGION: 'us-east-1',
    S3_BUCKET: 'damsen-media',
    S3_ACCESS_KEY: 'damsen_local',
    S3_SECRET_KEY: 'damsen_local_password',
    NARRATION_LOCALES_CONFIG_PATH: 'config/narration-locales.json',
    ACCESS_TOKEN_SECRET: demoEnv.ACCESS_TOKEN_SECRET,
    REFRESH_TOKEN_SECRET: demoEnv.REFRESH_TOKEN_SECRET,
    DEV_SEED_ADMIN: 'true',
    DEV_ADMIN_EMAIL: ADMIN_EMAIL,
    DEV_ADMIN_PASSWORD: ADMIN_PASSWORD,
    TTS_VOICES_MANIFEST_PATH:
      process.env.DEMO_VOICES_MANIFEST ?? 'config/tts-voices.json',
    TTS_GENERATION_ENABLED: 'true',
    SEARCH_HYBRID_ENABLED: 'true',
    SEARCH_EMBEDDING_URL: `http://127.0.0.1:${PORTS.embedding}/embed`,
    SEARCH_EMBEDDING_MODEL: EMBEDDING_MODEL,
    SEARCH_EMBEDDING_MODEL_VERSION:
      process.env.DEMO_EMBEDDING_MODEL_VERSION ?? EMBEDDING_MODEL_VERSION,
    // bge-m3 on a laptop CPU: the first queries can take > 2 s.
    SEARCH_EMBEDDING_TIMEOUT_MS: '5000',
    SEARCH_HYBRID_MIN_SIMILARITY: demoEnv.SEARCH_HYBRID_MIN_SIMILARITY ?? '0.5',
    SEARCH_HYBRID_EXPAND: demoEnv.SEARCH_HYBRID_EXPAND ?? 'true',
  };
}

/** Start a long-running process with its output in .demo/logs/<name>.log. */
export async function startService(name, command, args, options = {}) {
  await mkdir(logDir, { recursive: true });
  const log = createWriteStream(join(logDir, `${name}.log`), { flags: 'a' });
  log.write(`\n===== ${new Date().toISOString()} start ${name} =====\n`);
  const child = spawn(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: { ...process.env, ...options.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  child.on('exit', (code, signal) => {
    log.write(`===== exit ${code ?? signal} =====\n`);
    options.onExit?.(code, signal);
  });
  return child;
}

export function openBrowser(url) {
  try {
    const [command, args] = isWindows
      ? ['explorer.exe', [url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
    spawn(command, args, {
      stdio: 'ignore',
      detached: true,
      windowsHide: true,
    }).unref();
  } catch {
    // No browser available (e.g. a server): the URLs are printed anyway.
  }
}
