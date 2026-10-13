/* global console */
import process from 'node:process';

import pg from 'pg';

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(2);
}

const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });

try {
  const [balances, paymentCredits, redemptionDebits] = await Promise.all([
    pool.query(`
      SELECT count(*)::int AS violations
      FROM loyalty_accounts account
      LEFT JOIN (
        SELECT user_id, sum(delta)::int AS ledger_balance
        FROM loyalty_ledger_entries GROUP BY user_id
      ) ledger USING (user_id)
      WHERE account.balance <> COALESCE(ledger.ledger_balance, 0)
    `),
    pool.query(`
      SELECT count(*)::int AS violations
      FROM payment_orders payment
      LEFT JOIN loyalty_ledger_entries ledger
        ON ledger.source_type = 'payment_order'
       AND ledger.source_id = payment.id
       AND ledger.entry_type = 'payment_credit'
      WHERE payment.status = 'succeeded'
      GROUP BY payment.id, payment.total_points
      HAVING count(ledger.id) <> 1
          OR COALESCE(sum(ledger.delta), 0) <> payment.total_points
    `),
    pool.query(`
      SELECT count(*)::int AS violations
      FROM reward_redemptions redemption
      LEFT JOIN loyalty_ledger_entries ledger
        ON ledger.source_type = 'reward_redemption'
       AND ledger.source_id = redemption.id
       AND ledger.entry_type = 'redemption_debit'
      WHERE redemption.status IN ('confirmed', 'fulfilled')
      GROUP BY redemption.id, redemption.points_cost
      HAVING count(ledger.id) <> 1
          OR COALESCE(sum(ledger.delta), 0) <> -redemption.points_cost
    `),
  ]);

  const result = {
    balanceMismatches: balances.rows[0]?.violations ?? 0,
    paymentCreditMismatches: paymentCredits.rowCount,
    redemptionDebitMismatches: redemptionDebits.rowCount,
  };
  console.log(JSON.stringify(result));
  if (Object.values(result).some((count) => count > 0)) process.exitCode = 1;
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'Consistency check failed',
  );
  process.exitCode = 2;
} finally {
  await pool.end();
}
