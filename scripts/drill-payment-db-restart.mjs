/* global AbortSignal, console, fetch, setTimeout */
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { spawn } from 'node:child_process';

import pg from 'pg';

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`${name} is required`);
    process.exit(2);
  }
  return value;
};

const apiUrl = (process.env.OPERATIONS_DRILL_API_URL ?? 'http://127.0.0.1:3000')
  .trim()
  .replace(/\/$/, '');
const databaseUrl = required('DATABASE_URL');
const container = required('OPERATIONS_DB_CONTAINER');
const adminEmail = required('OPERATIONS_DRILL_ADMIN_EMAIL');
const adminPassword = required('OPERATIONS_DRILL_ADMIN_PASSWORD');
const phone = process.env.OPERATIONS_DRILL_PHONE?.trim() || '0900000000';

if (process.env.NODE_ENV === 'production' || /prod/i.test(container)) {
  console.error('Refusing to restart a production-like database container');
  process.exit(2);
}
if (process.env.OPERATIONS_DB_RESTART_CONFIRM !== 'restart-isolated-demo-db') {
  console.error(
    'Set OPERATIONS_DB_RESTART_CONFIRM=restart-isolated-demo-db to acknowledge the restart',
  );
  process.exit(2);
}

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function api(path, options = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.body === undefined
        ? {}
        : { 'content-type': 'application/json' }),
    },
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
    signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
  });
  if (!response.ok) throw new Error(`HTTP_${response.status}:${path}`);
  if (response.status === 204) return undefined;
  return response.json();
}

const restartContainer = () =>
  new Promise((resolve, reject) => {
    const child = spawn('docker', ['restart', container], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`docker restart exited ${code}: ${stderr.trim()}`));
    });
  });

async function retry(label, operation, attempts = 30) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      await sleep(200);
    }
  }
  throw new Error(`${label} did not recover: ${String(lastError)}`);
}

const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });

try {
  const staff = await api('/v1/auth/login', {
    method: 'POST',
    body: { email: adminEmail, password: adminPassword },
  });
  const visitor = await api('/v1/demo-auth/phone-session', {
    method: 'POST',
    body: { phone },
  });
  const products = await api('/v1/cashier/ticket-products', {
    token: staff.accessToken,
  });
  const customer = await api('/v1/cashier/customer-lookups', {
    method: 'POST',
    token: staff.accessToken,
    body: { phone },
  });
  const order = await api('/v1/cashier/payment-orders', {
    method: 'POST',
    token: staff.accessToken,
    body: {
      customerToken: customer.customerToken,
      idempotencyKey: randomUUID(),
      items: [{ ticketProductId: products[0].id, quantity: 1 }],
    },
  });
  const qrToken = order.qrUrl.split('/').at(-1);
  const confirmationKey = randomUUID();
  const originalConfirmation = api(`/v1/demo-payments/${qrToken}/confirm`, {
    method: 'POST',
    body: { idempotencyKey: confirmationKey },
    timeoutMs: 15_000,
  }).catch((error) => ({ requestFailed: String(error) }));

  await retry(
    'processing state',
    async () => {
      const current = await api(`/v1/demo-payments/${qrToken}`);
      if (current.status !== 'processing') throw new Error(current.status);
      return current;
    },
    40,
  );

  await restartContainer();
  const originalResult = await originalConfirmation;
  const succeeded = await retry('payment retry', async () => {
    const result = await api(`/v1/demo-payments/${qrToken}/confirm`, {
      method: 'POST',
      body: { idempotencyKey: confirmationKey },
    });
    if (result.status !== 'succeeded') throw new Error(result.status);
    return result;
  });
  const loyalty = await retry('loyalty snapshot', () =>
    api('/v1/me/loyalty', { token: visitor.accessToken }),
  );
  const database = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM loyalty_ledger_entries
        WHERE source_type = 'payment_order' AND source_id = $1
          AND entry_type = 'payment_credit') AS credit_entries,
       (SELECT count(*)::int FROM payment_simulation_events
        WHERE order_id = $1 AND step = 'processing') AS processing_events,
       (SELECT count(*)::int FROM payment_simulation_events
        WHERE order_id = $1 AND step = 'succeeded') AS succeeded_events,
       (SELECT count(*)::int FROM domain_outbox
        WHERE payload->>'orderId' = $1::text) AS outbox_events`,
    [order.id],
  );
  const counts = database.rows[0];
  const pass =
    succeeded.status === 'succeeded' &&
    loyalty.balance === order.totalPoints &&
    counts.credit_entries === 1 &&
    counts.processing_events === 1 &&
    counts.succeeded_events === 1 &&
    counts.outbox_events === 2;
  console.log(
    JSON.stringify({
      pass,
      originalRequestRecovered:
        !('requestFailed' in originalResult) &&
        originalResult.status === 'succeeded',
      finalStatus: succeeded.status,
      balanceMatches: loyalty.balance === order.totalPoints,
      ...counts,
    }),
  );
  if (!pass) process.exitCode = 1;
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'DB restart drill failed',
  );
  process.exitCode = 2;
} finally {
  await pool.end();
}
