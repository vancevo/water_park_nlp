import { startWorker } from './main.js';

/**
 * Worker process entrypoint (`npm run start|dev --workspace @damsen/worker`).
 * Fails fast on invalid configuration; SIGINT/SIGTERM stop claiming new jobs
 * and wait for in-flight jobs before closing the database pool.
 */
let worker: ReturnType<typeof startWorker>;
try {
  worker = startWorker();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'worker start failed');
  process.exit(1);
}

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    console.log(`tts worker: ${signal} — draining in-flight jobs`);
    void worker.stop().then(() => process.exit(0));
  });
}
