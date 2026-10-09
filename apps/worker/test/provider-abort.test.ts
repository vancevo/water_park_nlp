import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';

import { spawnCliRunner } from '../src/tts/providers/cli-tts-provider.js';
import {
  TtsTimeoutError,
  runWithTimeout,
} from '../src/tts/tts-generation-service.js';

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe('F5: a timed-out attempt stops the whole provider process tree', () => {
  it('kills the shell wrapper AND the engine it spawned', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'abort-test-'));
    const pidFile = join(dir, 'engine.pid');
    try {
      const run = runWithTimeout(
        (signal) =>
          spawnCliRunner({
            command: 'sh',
            // The "engine" is a grandchild of the wrapper, like a real CLI shim.
            args: ['-c', `sleep 30 & echo $! > ${pidFile}; wait`],
            stdin: null,
            outPath: join(dir, 'out.wav'),
            timeoutMs: 60_000,
            signal,
          }),
        300,
      );
      await expect(run).rejects.toBeInstanceOf(TtsTimeoutError);
      const enginePid = Number((await readFile(pidFile, 'utf8')).trim());
      expect(enginePid).toBeGreaterThan(1);
      await sleep(200);
      expect(alive(enginePid)).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('passes an aborted signal to a provider that is already past its deadline', async () => {
    let seen: AbortSignal | undefined;
    await expect(
      runWithTimeout((signal) => {
        seen = signal;
        return new Promise<never>(() => undefined);
      }, 20),
    ).rejects.toBeInstanceOf(TtsTimeoutError);
    expect(seen?.aborted).toBe(true);
  });
});
