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
import { parseWav } from '../piper/wav.js';

/**
 * Generic external-CLI TTS adapter (AI05). A single provider-neutral adapter for
 * additional benchmark candidates — ZeroTTS, MOSS-TTS, etc. — that run as their
 * own pinned command in an isolated child process (never inside the API) and
 * write a WAV. The exact binary and flags come from each engine's model card and
 * live in the provider manifest, not in code, so adding a candidate is a config
 * edit. Piper keeps its own dedicated adapter.
 *
 * Privacy: the transcript is passed to the child (stdin or a substituted arg)
 * and never logged; errors surface only a stable code.
 */

export type HardwareClass = 'cpu' | 'gpu';

export class CliTtsSynthesisError extends Error {
  readonly code = 'TTS_PROVIDER_ERROR';
  constructor(provider: string, message: string) {
    super(`${provider} synthesis: ${message}`);
    this.name = 'CliTtsSynthesisError';
  }
}

export class CliTtsTimeoutError extends Error {
  readonly code = 'TTS_TIMEOUT';
  constructor() {
    super('cli tts synthesis timed out');
    this.name = 'CliTtsTimeoutError';
  }
}

export interface CliRunInput {
  command: string;
  args: readonly string[];
  /** Transcript piped to stdin, or null when the spec passes it via an arg. */
  stdin: string | null;
  /** Temp path the command is told to write the WAV to. */
  outPath: string;
  timeoutMs: number;
}

/** Produces WAV bytes from one CLI run. Injected in tests. */
export type CliRunner = (input: CliRunInput) => Promise<Uint8Array>;

export interface CliProviderSpec {
  provider: string;
  model: string;
  /** Pinned, immutable model revision — never `main`/`latest`. */
  modelVersion: string;
  voiceId: string;
  locale: string;
  hardwareClass: HardwareClass;
  /** Executable (on PATH or absolute). */
  command: string;
  /**
   * Argument template. These placeholders are substituted per call:
   * `{out}` (output WAV path), `{model}` (modelPath), `{voice}` (voiceId),
   * `{speaker}` (speaker), `{text}` (transcript — only when textViaStdin=false).
   */
  argsTemplate: readonly string[];
  /** When true the transcript is written to stdin instead of an arg. */
  textViaStdin: boolean;
  /** Path to the local model/weights, substituted into `{model}`. */
  modelPath?: string;
  speaker?: number;
  timeoutMs?: number;
}

/** Default runner: spawn the command, wait with a timeout, read the WAV back. */
export const spawnCliRunner: CliRunner = async (input) => {
  await new Promise<void>((resolveRun, reject) => {
    const child = spawn(input.command, [...input.args], {
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new CliTtsTimeoutError());
    }, input.timeoutMs);
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < 2000) stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new CliTtsSynthesisError(input.command, error.message));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolveRun();
      else
        reject(
          new CliTtsSynthesisError(
            input.command,
            `exited with code ${code ?? 'null'}`,
          ),
        );
    });
    if (input.stdin !== null) child.stdin?.end(input.stdin, 'utf8');
    else child.stdin?.end();
  });
  return new Uint8Array(await readFile(input.outPath));
};

function substitute(
  template: readonly string[],
  values: Readonly<Record<string, string>>,
): string[] {
  return template.map((arg) =>
    arg.replace(/\{(out|model|voice|speaker|text)\}/gu, (_m, key: string) =>
      key in values ? values[key]! : `{${key}}`,
    ),
  );
}

export class CliTtsProvider implements TtsProvider {
  readonly provider: string;
  readonly model: string;
  readonly modelVersion: string;
  readonly voiceId: string;
  readonly hardwareClass: HardwareClass;
  private readonly locale: string;
  private readonly timeoutMs: number;

  constructor(
    private readonly spec: CliProviderSpec,
    private readonly runner: CliRunner = spawnCliRunner,
  ) {
    this.provider = spec.provider;
    this.model = spec.model;
    this.modelVersion = spec.modelVersion;
    this.voiceId = spec.voiceId;
    this.hardwareClass = spec.hardwareClass;
    this.locale = spec.locale;
    this.timeoutMs = spec.timeoutMs ?? 120_000;
  }

  supportsLocale(locale: string): boolean {
    return locale === this.locale;
  }

  async synthesize(request: TtsSynthesisRequest): Promise<TtsSynthesisResult> {
    const dir = await mkdtemp(join(tmpdir(), `${this.spec.provider}-`));
    const outPath = join(dir, `${randomUUID()}.wav`);
    try {
      const values: Record<string, string> = {
        out: outPath,
        model: this.spec.modelPath ?? '',
        voice: this.spec.voiceId,
        speaker:
          this.spec.speaker === undefined ? '' : String(this.spec.speaker),
        text: this.spec.textViaStdin ? '' : request.transcript,
      };
      const audio = await this.runner({
        command: this.spec.command,
        args: substitute(this.spec.argsTemplate, values),
        stdin: this.spec.textViaStdin ? request.transcript : null,
        outPath,
        timeoutMs: this.timeoutMs,
      });
      const info = parseWav(audio);
      return {
        audio,
        mimeType: 'audio/wav',
        durationSeconds: info.durationSeconds,
        sampleRateHz: info.sampleRateHz,
      };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
