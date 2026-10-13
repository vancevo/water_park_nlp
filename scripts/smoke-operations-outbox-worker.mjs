/* global AbortSignal, clearTimeout, console, fetch, setTimeout */
import { randomUUID } from 'node:crypto';
import process from 'node:process';

import pg from 'pg';
import { io } from 'socket.io-client';

const databaseUrl = process.env.DATABASE_URL?.trim();
const apiUrl = (process.env.OPERATIONS_SMOKE_API_URL ?? 'http://127.0.0.1:3000')
  .trim()
  .replace(/\/$/, '');
const email = process.env.OPERATIONS_SMOKE_ADMIN_EMAIL?.trim();
const password = process.env.OPERATIONS_SMOKE_ADMIN_PASSWORD?.trim();
if (!databaseUrl || !email || !password) {
  console.error(
    'DATABASE_URL, OPERATIONS_SMOKE_ADMIN_EMAIL and OPERATIONS_SMOKE_ADMIN_PASSWORD are required',
  );
  process.exit(2);
}

const login = await fetch(`${apiUrl}/v1/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password }),
  signal: AbortSignal.timeout(5_000),
});
if (!login.ok) throw new Error(`LOGIN_HTTP_${login.status}`);
const session = await login.json();
const socket = io(`${apiUrl}/realtime`, {
  auth: { token: session.accessToken },
  transports: ['websocket'],
  reconnection: false,
});
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
const eventId = randomUUID();

try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('SOCKET_TIMEOUT')), 5_000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('connect_error', reject);
  });
  const delivered = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('EVENT_TIMEOUT')), 8_000);
    socket.on('loyalty.balance_changed.v1', (event) => {
      if (event?.eventId !== eventId) return;
      clearTimeout(timer);
      resolve(event);
    });
  });
  await pool.query(
    `INSERT INTO domain_outbox (id, event_type, aggregate_id, payload, created_at)
     VALUES ($1, 'loyalty.balance_changed.v1', $2, $3::jsonb, now())`,
    [
      eventId,
      session.user.id,
      JSON.stringify({ userId: session.user.id, balance: 0 }),
    ],
  );
  const event = await delivered;
  const stored = await pool.query(
    'SELECT published_at IS NOT NULL AS published FROM domain_outbox WHERE id = $1',
    [eventId],
  );
  const pass =
    event.schemaVersion === 1 &&
    event.sequence > 0 &&
    stored.rows[0]?.published === true;
  console.log(
    JSON.stringify({
      pass,
      delivered: true,
      schemaVersion: event.schemaVersion,
      sequencePositive: event.sequence > 0,
      published: stored.rows[0]?.published === true,
    }),
  );
  if (!pass) process.exitCode = 1;
} finally {
  socket.disconnect();
  await pool.end();
}
