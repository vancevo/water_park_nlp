/* global console */
import process from 'node:process';

import pg from 'pg';

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(2);
}

const threshold = (name, fallback) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value < 0) {
    console.error(`${name} must be a non-negative number`);
    process.exit(2);
  }
  return value;
};

const limits = {
  pendingOutbox: threshold('OPERATIONS_ALERT_PENDING_OUTBOX', 100),
  oldestPendingSeconds: threshold(
    'OPERATIONS_ALERT_OLDEST_PENDING_SECONDS',
    60,
  ),
  deadLetters: threshold('OPERATIONS_ALERT_DEAD_LETTERS', 0),
  stuckPayments: threshold('OPERATIONS_ALERT_STUCK_PAYMENTS', 0),
};
const stuckAfterSeconds = threshold('OPERATIONS_STUCK_PAYMENT_SECONDS', 60);
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });

try {
  const result = await pool.query(
    `SELECT
       count(*) FILTER (
         WHERE published_at IS NULL AND dead_lettered_at IS NULL
       )::int AS pending_outbox,
       COALESCE(EXTRACT(epoch FROM now() - min(created_at) FILTER (
         WHERE published_at IS NULL AND dead_lettered_at IS NULL
       )), 0)::int AS oldest_pending_seconds,
       count(*) FILTER (WHERE dead_lettered_at IS NOT NULL)::int AS dead_letters,
       (SELECT count(*)::int FROM payment_orders
        WHERE status = 'processing'
          AND processing_at < now() - make_interval(secs => $1)) AS stuck_payments
     FROM domain_outbox`,
    [stuckAfterSeconds],
  );
  const metrics = result.rows[0];
  const alerts = {
    pendingOutbox: metrics.pending_outbox > limits.pendingOutbox,
    oldestPending: metrics.oldest_pending_seconds > limits.oldestPendingSeconds,
    deadLetters: metrics.dead_letters > limits.deadLetters,
    stuckPayments: metrics.stuck_payments > limits.stuckPayments,
  };
  const healthy = Object.values(alerts).every((active) => !active);
  console.log(JSON.stringify({ healthy, metrics, limits, alerts }));
  if (!healthy) process.exitCode = 1;
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'Operations health check failed',
  );
  process.exitCode = 2;
} finally {
  await pool.end();
}
