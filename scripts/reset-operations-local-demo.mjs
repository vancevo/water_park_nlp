/* global AbortSignal, console, fetch, setTimeout */
import process from 'node:process';
import { URL } from 'node:url';

import pg from 'pg';
import { createClient } from 'redis';

import { docker, ensureDemoEnv, serviceEnv } from './demo/lib.mjs';

const confirmation = 'reset-local-demo-operations';
const env = serviceEnv(await ensureDemoEnv());
const databaseUrl = process.env.DATABASE_URL ?? env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL ?? env.REDIS_URL;
const parsed = new URL(databaseUrl);
const localHosts = new Set(['127.0.0.1', 'localhost', '::1']);

if (
  process.env.NODE_ENV === 'production' ||
  parsed.protocol !== 'postgresql:' ||
  !localHosts.has(parsed.hostname) ||
  parsed.port !== '64321' ||
  parsed.pathname !== '/damsen'
) {
  console.error('Reset only accepts the guarded local demo database');
  process.exit(2);
}

try {
  const response = await fetch('http://127.0.0.1:3000/health', {
    signal: AbortSignal.timeout(500),
  });
  if (response.ok) {
    console.error('Stop the local demo before resetting operations data');
    process.exit(2);
  }
} catch {
  // Expected: reset is only allowed while the API is stopped.
}

const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });

await docker(['up', '-d', 'postgres', 'redis'], { quiet: true });

async function connectDatabase() {
  let lastError;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      return await pool.connect();
    } catch (error) {
      lastError = error;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
    }
  }
  throw lastError;
}

async function counts(client) {
  const result = await client.query(`
    SELECT
      (SELECT count(*)::int FROM user_phone_identities) AS synthetic_users,
      (SELECT count(*)::int FROM payment_orders) AS payment_orders,
      (SELECT count(*)::int FROM loyalty_ledger_entries) AS ledger_entries,
      (SELECT count(*)::int FROM reward_redemptions) AS redemptions,
      (SELECT count(*)::int FROM domain_outbox) AS outbox_events,
      (SELECT count(*)::int FROM presence_sessions) AS presence_sessions
  `);
  const row = result.rows[0];
  return {
    syntheticUsers: row.synthetic_users,
    paymentOrders: row.payment_orders,
    ledgerEntries: row.ledger_entries,
    redemptions: row.redemptions,
    outboxEvents: row.outbox_events,
    presenceSessions: row.presence_sessions,
  };
}

async function clearRedisPresence() {
  const client = createClient({
    url: redisUrl,
    socket: { connectTimeout: 1_000, reconnectStrategy: false },
  });
  client.on('error', () => undefined);
  try {
    await client.connect();
    let cursor = '0';
    let removed = 0;
    do {
      const page = await client.scan(cursor, {
        MATCH: 'damsen:demo:presence:*',
        COUNT: 100,
      });
      cursor = page.cursor;
      if (page.keys.length > 0) removed += await client.unlink(page.keys);
    } while (cursor !== '0');
    return removed;
  } finally {
    if (client.isReady) await client.quit();
    else if (client.isOpen) client.destroy();
  }
}

let client;
try {
  client = await connectDatabase();
  const before = await counts(client);
  if (process.env.OPERATIONS_DEMO_RESET_CONFIRM !== confirmation) {
    console.log(
      JSON.stringify({
        status: 'preview',
        scope: 'local-demo-only',
        before,
        requiredConfirmation: confirmation,
      }),
    );
    process.exitCode = 2;
  } else {
    await client.query('BEGIN');
    await client.query(`
      CREATE TEMP TABLE reset_demo_users ON COMMIT DROP AS
      SELECT user_id FROM user_phone_identities
    `);
    await client.query(`
      DELETE FROM audit_logs
      WHERE entity_id IN (SELECT user_id FROM reset_demo_users)
        AND action IN ('customer.lookup', 'loyalty.adjust')
    `);
    await client.query('DELETE FROM domain_outbox');
    await client.query('DELETE FROM reward_redemptions');
    await client.query('DELETE FROM loyalty_ledger_entries');
    await client.query('DELETE FROM demo_payment_tokens');
    await client.query('DELETE FROM payment_simulation_events');
    await client.query('DELETE FROM payment_order_items');
    await client.query('DELETE FROM payment_orders');
    await client.query('DELETE FROM demo_customer_tokens');
    await client.query('DELETE FROM loyalty_accounts');
    await client.query('DELETE FROM presence_zone_intervals');
    await client.query('DELETE FROM presence_sessions');
    await client.query('DELETE FROM user_phone_identities');
    await client.query(
      'DELETE FROM users WHERE id IN (SELECT user_id FROM reset_demo_users)',
    );
    await client.query('COMMIT');
    const redisPresenceKeysRemoved = await clearRedisPresence();
    const after = await counts(client);
    if (Object.values(after).some((value) => value !== 0)) {
      throw new Error('LOCAL_DEMO_RESET_INCOMPLETE');
    }
    console.log(
      JSON.stringify({
        status: 'reset',
        scope: 'local-demo-only',
        before,
        after,
        redisPresenceKeysRemoved,
        catalogsPreserved: true,
      }),
    );
  }
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  console.error(
    error instanceof Error ? error.message : 'LOCAL_DEMO_RESET_FAILED',
  );
  process.exitCode = 1;
} finally {
  client?.release();
  await pool.end();
}
