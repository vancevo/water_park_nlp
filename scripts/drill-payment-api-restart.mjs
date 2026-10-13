/* global AbortSignal, console, fetch, setTimeout */
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { URL } from 'node:url';

import pg from 'pg';

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(2);
}
if (process.env.OPERATIONS_API_RESTART_CONFIRM !== 'restart-demo-api') {
  console.error(
    'Set OPERATIONS_API_RESTART_CONFIRM=restart-demo-api to acknowledge the drill',
  );
  process.exit(2);
}
if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run the API restart drill in production');
  process.exit(2);
}

const port = Number(process.env.OPERATIONS_DRILL_API_PORT ?? 3011);
const apiUrl = `http://127.0.0.1:${port}`;
const adminEmail = 'restart-drill-admin@example.invalid';
const adminPassword = 'restart-drill-password-only';
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
let apiProcess;

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
  return response.json();
}

async function waitForApi() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${apiUrl}/health`, {
        signal: AbortSignal.timeout(500),
      });
      if (response.ok) return;
    } catch {
      // Expected while the replacement process starts.
    }
    await sleep(100);
  }
  throw new Error('API did not become healthy');
}

async function startApi(demoEnabled = true) {
  apiProcess = spawn(process.execPath, ['apps/api/dist/main.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(port),
      DATABASE_URL: databaseUrl,
      S3_ENABLED: 'false',
      REALTIME_REDIS_ENABLED: 'false',
      DEV_SEED_ADMIN: 'true',
      DEV_ADMIN_EMAIL: adminEmail,
      DEV_ADMIN_PASSWORD: adminPassword,
      DEMO_MODE: String(demoEnabled),
      DEMO_PHONE_AUTH_ENABLED: String(demoEnabled),
      DEMO_PAYMENTS_ENABLED: String(demoEnabled),
      DEMO_PAYMENT_PROCESSING_DELAY_MS: '5000',
    },
    stdio: 'ignore',
  });
  await waitForApi();
}

async function stopApi() {
  if (!apiProcess || apiProcess.exitCode !== null) return;
  apiProcess.kill('SIGKILL');
  await new Promise((resolve) => apiProcess.once('exit', resolve));
}

try {
  const database = await pool.query('SELECT current_database() AS name');
  const databaseName = String(database.rows[0]?.name ?? '');
  if (!/(drill|demo|test)/i.test(databaseName) || /prod/i.test(databaseName)) {
    throw new Error(
      'Refusing a database that is not clearly isolated for a drill',
    );
  }

  await startApi();
  const session = await api('/v1/auth/login', {
    method: 'POST',
    body: { email: adminEmail, password: adminPassword },
  });
  const visitor = await api('/v1/demo-auth/phone-session', {
    method: 'POST',
    body: { phone: '0900000011' },
  });
  const products = await api('/v1/cashier/ticket-products', {
    token: session.accessToken,
  });
  const customer = await api('/v1/cashier/customer-lookups', {
    method: 'POST',
    token: session.accessToken,
    body: { phone: '0900000011' },
  });
  const order = await api('/v1/cashier/payment-orders', {
    method: 'POST',
    token: session.accessToken,
    body: {
      customerToken: customer.customerToken,
      idempotencyKey: randomUUID(),
      items: [{ ticketProductId: products[0].id, quantity: 1 }],
    },
  });
  const qrToken = new URL(order.qrUrl).pathname.split('/').at(-1);
  const confirmation = { idempotencyKey: randomUUID() };
  const interrupted = api(`/v1/demo-payments/${qrToken}/confirm`, {
    method: 'POST',
    body: confirmation,
    timeoutMs: 15_000,
  }).catch(() => undefined);

  let processingObserved = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const snapshot = await api(`/v1/demo-payments/${qrToken}`);
    if (snapshot.status === 'processing') {
      processingObserved = true;
      break;
    }
    await sleep(100);
  }
  if (!processingObserved) throw new Error('processing state was not observed');
  await stopApi();
  await interrupted;
  await startApi();

  const recovered = await api(`/v1/demo-payments/${qrToken}/confirm`, {
    method: 'POST',
    body: confirmation,
    timeoutMs: 15_000,
  });
  const invariant = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM loyalty_ledger_entries
        WHERE source_type = 'payment_order' AND source_id = $1) AS credit_entries,
       (SELECT count(*)::int FROM payment_simulation_events
        WHERE order_id = $1 AND step = 'processing') AS processing_events,
       (SELECT count(*)::int FROM payment_simulation_events
        WHERE order_id = $1 AND step = 'succeeded') AS succeeded_events,
       (SELECT balance FROM loyalty_accounts WHERE user_id = $2) AS balance`,
    [order.id, customer.userId],
  );
  const row = invariant.rows[0];
  await stopApi();
  await startApi(false);
  const disabledPhone = await fetch(`${apiUrl}/v1/demo-auth/phone-session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone: '0900000011' }),
    signal: AbortSignal.timeout(5_000),
  });
  const disabledPayment = await fetch(`${apiUrl}/v1/demo-payments/${qrToken}`, {
    signal: AbortSignal.timeout(5_000),
  });
  const persisted = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM payment_orders WHERE id = $1) AS orders,
       (SELECT count(*)::int FROM loyalty_ledger_entries
        WHERE source_type = 'payment_order' AND source_id = $1) AS credits`,
    [order.id],
  );
  const flagsPreserveData =
    disabledPhone.status === 503 &&
    disabledPayment.status === 503 &&
    persisted.rows[0]?.orders === 1 &&
    persisted.rows[0]?.credits === 1;
  const pass =
    recovered.status === 'succeeded' &&
    row.credit_entries === 1 &&
    row.processing_events === 1 &&
    row.succeeded_events === 1 &&
    row.balance === products[0].pointsPerItem &&
    flagsPreserveData;
  console.log(
    JSON.stringify({
      pass,
      processingObserved,
      finalStatus: recovered.status,
      creditEntries: row.credit_entries,
      processingEvents: row.processing_events,
      succeededEvents: row.succeeded_events,
      balanceMatches: row.balance === products[0].pointsPerItem,
      visitorIdMatched: visitor.user.id === customer.userId,
      flagsPreserveData,
    }),
  );
  if (!pass) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await stopApi();
  await pool.end();
}
