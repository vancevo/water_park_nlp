/* global console */
import { constants as fsConstants } from 'node:fs';
import { access, chmod, mkdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { URL } from 'node:url';

import pg from 'pg';

const mode = process.argv[2];
const MODES = ['backup', 'restore', 'drill'];
if (!MODES.includes(mode)) {
  console.error(
    `usage: node scripts/operations-db-backup.mjs <${MODES.join('|')}>`,
  );
  process.exit(2);
}

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`${name} is required`);
    process.exit(2);
  }
  return value;
};

const sourceUrl = required('DATABASE_URL');
const archivePath = resolve(required('OPERATIONS_BACKUP_PATH'));
const targetUrl = process.env.OPERATIONS_RESTORE_DATABASE_URL?.trim();
const pgDumpBin = process.env.PG_DUMP_BIN?.trim() || 'pg_dump';
const pgRestoreBin = process.env.PG_RESTORE_BIN?.trim() || 'pg_restore';
const operationsTables = [
  'user_phone_identities',
  'loyalty_accounts',
  'payment_orders',
  'payment_simulation_events',
  'loyalty_ledger_entries',
  'reward_redemptions',
  'domain_outbox',
  'presence_sessions',
  'presence_zone_intervals',
];

const databaseIdentity = (rawUrl) => {
  const url = new URL(rawUrl);
  return `${url.hostname}/${decodeURIComponent(url.pathname.slice(1))}`;
};

const pgEnvironment = (rawUrl) => {
  const url = new URL(rawUrl);
  const env = {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
  };
  const sslMode = url.searchParams.get('sslmode');
  if (sslMode) env.PGSSLMODE = sslMode;
  return env;
};

const run = (command, args, rawUrl) =>
  new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      env: pgEnvironment(rawUrl),
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolveRun();
      else reject(new Error(`${command} exited ${code}: ${stderr.trim()}`));
    });
  });

async function exists(path) {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function snapshot(rawUrl) {
  const pool = new pg.Pool({ connectionString: rawUrl, max: 1 });
  try {
    const counts = {};
    for (const table of operationsTables) {
      const result = await pool.query(
        `SELECT count(*)::int AS count FROM ${table}`,
      );
      counts[table] = result.rows[0].count;
    }
    const invariants = await pool.query(`
      SELECT
        (SELECT count(*)::int FROM loyalty_accounts account
          LEFT JOIN (SELECT user_id, sum(delta)::int AS balance
            FROM loyalty_ledger_entries GROUP BY user_id) ledger USING (user_id)
          WHERE account.balance <> COALESCE(ledger.balance, 0)) AS balance_mismatches,
        (SELECT count(*)::int FROM payment_orders payment
          WHERE payment.status = 'succeeded' AND NOT EXISTS (
            SELECT 1 FROM loyalty_ledger_entries ledger
            WHERE ledger.source_type = 'payment_order'
              AND ledger.source_id = payment.id
              AND ledger.entry_type = 'payment_credit')) AS payment_mismatches,
        (SELECT count(*)::int FROM reward_redemptions redemption
          WHERE redemption.status IN ('confirmed', 'fulfilled') AND NOT EXISTS (
            SELECT 1 FROM loyalty_ledger_entries ledger
            WHERE ledger.source_type = 'reward_redemption'
              AND ledger.source_id = redemption.id
              AND ledger.entry_type = 'redemption_debit')) AS redemption_mismatches
    `);
    return { counts, invariants: invariants.rows[0] };
  } finally {
    await pool.end();
  }
}

async function backup() {
  if (
    (await exists(archivePath)) &&
    process.env.OPERATIONS_BACKUP_OVERWRITE !== 'replace-archive'
  ) {
    throw new Error(
      'Archive already exists; choose another path or set OPERATIONS_BACKUP_OVERWRITE=replace-archive',
    );
  }
  await mkdir(dirname(archivePath), { recursive: true });
  await run(
    pgDumpBin,
    ['--format=custom', '--no-owner', '--no-privileges', '--file', archivePath],
    sourceUrl,
  );
  await chmod(archivePath, 0o600);
  const archive = await stat(archivePath);
  const state = await snapshot(sourceUrl);
  console.log(
    JSON.stringify({
      mode: 'backup',
      archiveBytes: archive.size,
      operationsCounts: state.counts,
      invariants: state.invariants,
    }),
  );
  return state;
}

function assertSafeRestoreTarget() {
  if (!targetUrl)
    throw new Error('OPERATIONS_RESTORE_DATABASE_URL is required');
  if (process.env.OPERATIONS_RESTORE_CONFIRM !== 'replace-demo-database') {
    throw new Error(
      'Set OPERATIONS_RESTORE_CONFIRM=replace-demo-database to acknowledge destructive restore',
    );
  }
  const source = databaseIdentity(sourceUrl).toLowerCase();
  const target = databaseIdentity(targetUrl).toLowerCase();
  if (source === target)
    throw new Error('Restore target must differ from source');
  if (target.includes('prod'))
    throw new Error('Refusing a production-like restore target');
  if (!/(restore|test|demo|drill|tmp)/.test(target)) {
    throw new Error(
      'Restore target name must include restore/test/demo/drill/tmp',
    );
  }
}

async function restore() {
  assertSafeRestoreTarget();
  if (!(await exists(archivePath)))
    throw new Error('Backup archive does not exist');
  await run(
    pgRestoreBin,
    [
      '--clean',
      '--if-exists',
      '--no-owner',
      '--no-privileges',
      '--exit-on-error',
      '--dbname',
      decodeURIComponent(new URL(targetUrl).pathname.slice(1)),
      archivePath,
    ],
    targetUrl,
  );
  return snapshot(targetUrl);
}

try {
  if (mode === 'backup') {
    await backup();
  } else if (mode === 'restore') {
    const restored = await restore();
    console.log(
      JSON.stringify({
        mode: 'restore',
        operationsCounts: restored.counts,
        invariants: restored.invariants,
      }),
    );
  } else {
    const source = await backup();
    const restored = await restore();
    const countsMatch =
      JSON.stringify(source.counts) === JSON.stringify(restored.counts);
    const invariantValues = Object.values(restored.invariants).map(Number);
    const invariantsPass = invariantValues.every((value) => value === 0);
    console.log(
      JSON.stringify({
        mode: 'drill',
        countsMatch,
        invariantsPass,
        operationsCounts: restored.counts,
      }),
    );
    if (!countsMatch || !invariantsPass) process.exitCode = 1;
  }
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'Database backup failed',
  );
  process.exitCode = 2;
}
