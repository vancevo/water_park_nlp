import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  TtsProvider,
  TtsSynthesisRequest,
  TtsSynthesisResult,
} from '../types.js';
import { killProcessTree } from '../process-kill.js';
import { parseWav } from './wav.js';

/**
 * Piper baseline adapter (C04 / AI03). Runs the pinned Piper binary in an
 * isolated child process (never inside the API) and returns a WAV. Provider-
 * neutral upstream: the domain only sees {@link TtsProvider}.
 */

export class PiperSynthesisError extends Error {
  readonly code = 'TTS_PROVIDER_ERROR';
  constructor(message: string) {
    super(`piper synthesis: ${message}`);
    this.name = 'PiperSynthesisError';
  }
}

export class PiperTimeoutError extends Error {
  readonly code = 'TTS_TIMEOUT';
  constructor() {
    super('piper synthesis timed out');
    this.name = 'PiperTimeoutError';
  }
}

export interface PiperRunInput {
  binaryPath: string;
  modelPath: string;
  /** Transcript text fed to the process on stdin. */
  text: string;
  timeoutMs: number;
  extraArgs: readonly string[];
  /** Aborted by the job runner's timeout: kill the engine process tree. */
  signal?: AbortSignal;
}

/** Produces WAV bytes from a Piper run. Injected in tests. */
export type PiperRunner = (input: PiperRunInput) => Promise<Uint8Array>;

export interface PiperProviderConfig {
  /** Voice model id, e.g. `vi_VN-vais1000-medium`. */
  model: string;
  /** Pinned voice version. */
  modelVersion: string;
  voiceId: string;
  locale: string;
  /** Path to the piper executable. */
  binaryPath: string;
  /** Path to the voice `.onnx` file. */
  modelPath: string;
  timeoutMs?: number;
  speaker?: number;
  lengthScale?: number;
}

/** Default runner: spawn piper, write to a temp WAV, read it back. */
export const spawnPiperRunner: PiperRunner = async (input) => {
  const dir = await mkdtemp(join(tmpdir(), 'piper-'));
  const outPath = join(dir, `${randomUUID()}.wav`);
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        input.binaryPath,
        [
          '--model',
          input.modelPath,
          '--output_file',
          outPath,
          ...input.extraArgs,
        ],
        {
          stdio: ['pipe', 'ignore', 'pipe'],
          // Own process group on POSIX (kill the whole tree); on Windows a
          // detached child would open a console window per synthesis.
          detached: process.platform !== 'win32',
          windowsHide: true,
        },
      );
      const stop = () => {
        killProcessTree(child);
        reject(new PiperTimeoutError());
      };
      const timer = setTimeout(stop, input.timeoutMs);
      if (input.signal?.aborted) stop();
      else input.signal?.addEventListener('abort', stop, { once: true });
      let stderr = '';
      child.stderr?.on('data', (chunk: Buffer) => {
        if (stderr.length < 2000) stderr += chunk.toString('utf8');
      });
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(new PiperSynthesisError(error.message));
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        input.signal?.removeEventListener('abort', stop);
        if (code === 0) resolve();
        else
          reject(new PiperSynthesisError(`exited with code ${code ?? 'null'}`));
      });
      child.stdin?.end(input.text, 'utf8');
    });
    return new Uint8Array(await readFile(outPath));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

export class PiperTtsProvider implements TtsProvider {
  readonly provider = 'piper';
  readonly model: string;
  readonly modelVersion: string;
  readonly voiceId: string;
  private readonly locale: string;
  private readonly timeoutMs: number;

  constructor(
    private readonly config: PiperProviderConfig,
    private readonly runner: PiperRunner = spawnPiperRunner,
  ) {
    this.model = config.model;
    this.modelVersion = config.modelVersion;
    this.voiceId = config.voiceId;
    this.locale = config.locale;
    this.timeoutMs = config.timeoutMs ?? 120_000;
  }

  supportsLocale(locale: string): boolean {
    return locale === this.locale;
  }

  async synthesize(request: TtsSynthesisRequest): Promise<TtsSynthesisResult> {
    const extraArgs: string[] = [];
    if (this.config.speaker !== undefined) {
      extraArgs.push('--speaker', String(this.config.speaker));
    }
    if (this.config.lengthScale !== undefined) {
      extraArgs.push('--length_scale', String(this.config.lengthScale));
    }

    const audio = await this.runner({
      binaryPath: this.config.binaryPath,
      modelPath: this.config.modelPath,
      text: request.transcript,
      timeoutMs: this.timeoutMs,
      extraArgs,
      signal: request.signal,
    });

    const info = parseWav(audio);
    return {
      audio,
      mimeType: 'audio/wav',
      durationSeconds: info.durationSeconds,
      sampleRateHz: info.sampleRateHz,
    };
  }
}
