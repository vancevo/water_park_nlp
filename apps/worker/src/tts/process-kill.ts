import type { ChildProcess } from 'node:child_process';
import process from 'node:process';

/**
 * Kill a provider process and everything it spawned. The child must be started
 * with `detached: true` so it leads its own process group; a shell wrapper's
 * grandchildren (the real engine) would otherwise outlive a plain `kill`.
 */
export function killProcessTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  try {
    if (process.platform === 'win32') child.kill('SIGKILL');
    else process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL'); // group already gone or not a group leader
  }
}
