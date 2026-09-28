import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Console } from 'node:console';
import process from 'node:process';

import pg from 'pg';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://damsen:damsen_local_only@127.0.0.1:64321/damsen';
const migrationsDirectory = resolve('infra/migrations');
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
const logger = new Console({ stdout: process.stdout, stderr: process.stderr });

try {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);

  const files = (await readdir(migrationsDirectory))
    .filter((name) => name.endsWith('.up.sql'))
    .sort((left, right) => left.localeCompare(right));

  for (const name of files) {
    const applied = await pool.query(
      'SELECT 1 FROM schema_migrations WHERE name = $1',
      [name],
    );
    if (applied.rowCount) {
      logger.log(`skip ${name}`);
      continue;
    }

    const sql = await readFile(resolve(migrationsDirectory, name), 'utf8');
    await pool.query(sql);
    await pool.query('INSERT INTO schema_migrations (name) VALUES ($1)', [
      name,
    ]);
    logger.log(`applied ${name}`);
  }
} catch (error) {
  logger.error(error instanceof Error ? error.message : 'Migration failed');
  process.exitCode = 1;
} finally {
  await pool.end();
}
