import { createRequire } from 'node:module';

interface PgPool {
  on(
    event: 'error',
    listener: (error: Error & { code?: string }) => void,
  ): void;
}

/**
 * Creates a `pg` Pool that survives a database restart/failover (I04).
 *
 * `pg` emits `error` on the pool when an IDLE client's connection is closed by
 * the server (restart, failover, `pg_terminate_backend`). Without a listener
 * Node treats it as an unhandled `error` event and kills the process. The
 * pool already discards the broken client and the next query reconnects, so
 * logging the stable code (never the connection string) is all that is needed.
 * `pg` is loaded lazily so tests/dev fixtures without a database never need it.
 */
export function createPgPool<T>(
  connectionString: string,
  label: string,
  log: (line: string) => void = (line) => console.error(line),
): T {
  const require = createRequire(import.meta.url);
  const pg = require('pg') as {
    Pool: new (options: { connectionString: string }) => PgPool;
  };
  const pool = new pg.Pool({ connectionString });
  pool.on('error', (error) => {
    log(
      `postgres pool (${label}): idle client error ${error.code ?? error.name}; client discarded`,
    );
  });
  return pool as T;
}
