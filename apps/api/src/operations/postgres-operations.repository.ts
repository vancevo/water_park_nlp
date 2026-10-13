import { randomUUID } from 'node:crypto';

import type {
  AdminPaymentFeedItem,
  DashboardSummary,
  DemoPaymentOrder,
  DemoPaymentOrderItem,
  LoyaltyAccountSummary,
  LoyaltyLedgerEntry,
  RewardCatalogItem,
  RewardRedemption,
  TicketProduct,
} from '@damsen/shared-types';
import type {
  CreateOrderRecord,
  DashboardRanges,
  LoyaltyAdjustmentRecord,
  OperationsRepository,
  PaymentFeedPageRecord,
  RedeemRewardRecord,
} from './operations.models.js';

interface Queryable {
  query<T extends object = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[]; rowCount?: number | null }>;
}

interface OperationsClient extends Queryable {
  release(): void;
}

export interface OperationsPool extends Queryable {
  connect(): Promise<OperationsClient>;
}

interface OrderRow {
  id: string;
  user_id: string;
  status: DemoPaymentOrder['status'];
  phone_last4: string;
  total_amount_vnd: string;
  total_points: number;
  qr_expires_at: Date | string;
  created_at: Date | string;
  processing_at: Date | string | null;
  paid_at: Date | string | null;
}

interface ItemRow {
  ticket_product_id: string;
  product_code: string;
  product_name: string;
  quantity: number;
  unit_amount_vnd: string;
  unit_points: number;
}

export class PostgresOperationsRepository implements OperationsRepository {
  constructor(private readonly pool: OperationsPool) {}

  async listTicketProducts(): Promise<TicketProduct[]> {
    const result = await this.pool.query<{
      id: string;
      code: string;
      name: string;
      amount_vnd: string;
      points_per_item: number;
      active: boolean;
    }>(
      `SELECT id, code, name, amount_vnd, points_per_item, active
       FROM ticket_products WHERE active = true ORDER BY amount_vnd, code`,
    );
    return result.rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      amountVnd: Number(row.amount_vnd),
      pointsPerItem: row.points_per_item,
      active: row.active,
    }));
  }

  async issueCustomerToken(input: {
    tokenHash: string;
    actorId: string;
    userId: string;
    phoneMasked: string;
    expiresAt: Date;
    now: Date;
  }): Promise<number> {
    const result = await this.pool.query<{ balance: number }>(
      `WITH account AS (
         INSERT INTO loyalty_accounts (user_id) VALUES ($2)
         ON CONFLICT (user_id) DO UPDATE SET updated_at = loyalty_accounts.updated_at
         RETURNING balance
       ), token AS (
         INSERT INTO demo_customer_tokens (token_hash, user_id, expires_at, created_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (token_hash) DO NOTHING
       ), audit AS (
         INSERT INTO audit_logs (
           id, actor_id, action, entity_type, entity_id, after_json, created_at
         ) VALUES ($5, $6, 'customer.lookup', 'user', $2,
           jsonb_build_object('result', 'masked_account'), $4)
       )
       SELECT balance FROM account`,
      [
        input.tokenHash,
        input.userId,
        input.expiresAt,
        input.now,
        randomUUID(),
        input.actorId,
      ],
    );
    return result.rows[0]?.balance ?? 0;
  }

  async createOrder(input: CreateOrderRecord): Promise<DemoPaymentOrder> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query<{ id: string }>(
        'SELECT id FROM payment_orders WHERE cashier_id = $1 AND idempotency_key = $2',
        [input.cashierId, input.idempotencyKey],
      );
      if (existing.rows[0]) {
        await client.query('COMMIT');
        const order = await this.loadOrder(this.pool, existing.rows[0].id);
        if (!order) throw new Error('PAYMENT_NOT_FOUND');
        return order;
      }

      const customer = await client.query<{ user_id: string }>(
        `SELECT user_id FROM demo_customer_tokens
         WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > $2
         FOR UPDATE`,
        [input.customerTokenHash, input.now],
      );
      const userId = customer.rows[0]?.user_id;
      if (!userId) throw new Error('CUSTOMER_TOKEN_INVALID');

      const ids = input.items.map((item) => item.ticketProductId);
      if (new Set(ids).size !== ids.length) {
        throw new Error('DUPLICATE_TICKET_PRODUCT');
      }
      const products = await client.query<{
        id: string;
        code: string;
        name: string;
        amount_vnd: string;
        points_per_item: number;
        version: number;
      }>(
        `SELECT tp.id, tp.code, tp.name, tp.amount_vnd, lr.points_per_item, lr.version
         FROM ticket_products tp
         JOIN LATERAL (
           SELECT points_per_item, version FROM loyalty_rules
           WHERE ticket_product_id = tp.id AND active = true
             AND effective_from <= $2 AND (effective_until IS NULL OR effective_until > $2)
           ORDER BY version DESC LIMIT 1
         ) lr ON true
         WHERE tp.id = ANY($1::uuid[]) AND tp.active = true`,
        [ids, input.now],
      );
      if (products.rows.length !== input.items.length) {
        throw new Error('TICKET_PRODUCT_NOT_FOUND');
      }
      const byId = new Map(products.rows.map((row) => [row.id, row]));
      const prepared = input.items.map((item) => {
        const product = byId.get(item.ticketProductId)!;
        return {
          ...item,
          product,
          subtotal: Number(product.amount_vnd) * item.quantity,
          points: product.points_per_item * item.quantity,
        };
      });
      const totalAmount = prepared.reduce(
        (sum, item) => sum + item.subtotal,
        0,
      );
      const totalPoints = prepared.reduce((sum, item) => sum + item.points, 0);

      await client.query(
        `INSERT INTO payment_orders (
           id, user_id, cashier_id, status, total_amount_vnd, total_points,
           idempotency_key, qr_expires_at, created_at, updated_at
         ) VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7, $8, $8)`,
        [
          input.id,
          userId,
          input.cashierId,
          totalAmount,
          totalPoints,
          input.idempotencyKey,
          input.qrExpiresAt,
          input.now,
        ],
      );
      for (const item of prepared) {
        await client.query(
          `INSERT INTO payment_order_items (
             id, order_id, ticket_product_id, product_code, product_name,
             quantity, unit_amount_vnd, unit_points, rule_version
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            randomUUID(),
            input.id,
            item.ticketProductId,
            item.product.code,
            item.product.name,
            item.quantity,
            item.product.amount_vnd,
            item.product.points_per_item,
            item.product.version,
          ],
        );
      }
      await client.query(
        `INSERT INTO demo_payment_tokens (token_hash, order_id, expires_at, created_at)
         VALUES ($1, $2, $3, $4)`,
        [input.qrTokenHash, input.id, input.qrExpiresAt, input.now],
      );
      await client.query(
        'UPDATE demo_customer_tokens SET consumed_at = $2 WHERE token_hash = $1',
        [input.customerTokenHash, input.now],
      );
      await client.query('COMMIT');
      const order = await this.loadOrder(this.pool, input.id);
      if (!order) throw new Error('PAYMENT_NOT_FOUND');
      order.qrUrl = input.qrUrl;
      return order;
    } catch (error) {
      await this.safeRollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  findOrderById(id: string): Promise<DemoPaymentOrder | null> {
    return this.loadOrder(this.pool, id);
  }

  async findOrderUserId(id: string): Promise<string | null> {
    const result = await this.pool.query<{ user_id: string }>(
      'SELECT user_id FROM payment_orders WHERE id = $1',
      [id],
    );
    return result.rows[0]?.user_id ?? null;
  }

  async findOrderCashierId(id: string): Promise<string | null> {
    const result = await this.pool.query<{ cashier_id: string }>(
      'SELECT cashier_id FROM payment_orders WHERE id = $1',
      [id],
    );
    return result.rows[0]?.cashier_id ?? null;
  }

  async findOrderByQrToken(
    tokenHash: string,
    now: Date,
  ): Promise<DemoPaymentOrder | null> {
    const result = await this.pool.query<{
      order_id: string;
      expires_at: Date | string;
    }>(
      'SELECT order_id, expires_at FROM demo_payment_tokens WHERE token_hash = $1',
      [tokenHash],
    );
    const token = result.rows[0];
    if (!token) return null;
    if (new Date(token.expires_at) <= now) {
      await this.pool.query(
        `UPDATE payment_orders SET status = 'expired', updated_at = $2
         WHERE id = $1 AND status = 'pending'`,
        [token.order_id, now],
      );
    }
    return this.loadOrder(this.pool, token.order_id);
  }

  async beginSimulation(
    tokenHash: string,
    idempotencyKey: string,
    now: Date,
  ): Promise<DemoPaymentOrder> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<{
        order_id: string;
        expires_at: Date | string;
        consumed_at: Date | string | null;
      }>(
        'SELECT order_id, expires_at, consumed_at FROM demo_payment_tokens WHERE token_hash = $1 FOR UPDATE',
        [tokenHash],
      );
      const token = result.rows[0];
      if (!token) throw new Error('PAYMENT_TOKEN_INVALID');
      const state = await client.query<{ status: DemoPaymentOrder['status'] }>(
        'SELECT status FROM payment_orders WHERE id = $1 FOR UPDATE',
        [token.order_id],
      );
      const status = state.rows[0]?.status;
      if (!status) throw new Error('PAYMENT_NOT_FOUND');
      if (['succeeded', 'failed', 'processing'].includes(status)) {
        const attempt = await client.query<{ idempotency_key: string }>(
          `SELECT idempotency_key FROM payment_simulation_events
           WHERE order_id = $1 AND step = 'processing'
           ORDER BY created_at LIMIT 1`,
          [token.order_id],
        );
        if (attempt.rows[0]?.idempotency_key !== idempotencyKey) {
          throw new Error('PAYMENT_TOKEN_CONSUMED');
        }
        await client.query('COMMIT');
        const order = await this.loadOrder(this.pool, token.order_id);
        if (!order) throw new Error('PAYMENT_NOT_FOUND');
        return order;
      }
      if (status !== 'pending' || new Date(token.expires_at) <= now) {
        if (status === 'pending') {
          await client.query(
            "UPDATE payment_orders SET status = 'expired', updated_at = $2 WHERE id = $1",
            [token.order_id, now],
          );
        }
        throw new Error('PAYMENT_NOT_PENDING');
      }
      await client.query(
        `UPDATE payment_orders
         SET status = 'processing', processing_at = $2, updated_at = $2
         WHERE id = $1`,
        [token.order_id, now],
      );
      await client.query(
        `INSERT INTO payment_simulation_events (id, order_id, step, idempotency_key, created_at)
         VALUES ($1, $2, 'processing', $3, $4) ON CONFLICT DO NOTHING`,
        [randomUUID(), token.order_id, idempotencyKey, now],
      );
      await client.query('COMMIT');
      const order = await this.loadOrder(this.pool, token.order_id);
      if (!order) throw new Error('PAYMENT_NOT_FOUND');
      return order;
    } catch (error) {
      await this.safeRollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async completeSimulation(
    orderId: string,
    idempotencyKey: string,
    now: Date,
  ): Promise<DemoPaymentOrder> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const orderResult = await client.query<{
        user_id: string;
        status: DemoPaymentOrder['status'];
        total_points: number;
      }>(
        'SELECT user_id, status, total_points FROM payment_orders WHERE id = $1 FOR UPDATE',
        [orderId],
      );
      const source = orderResult.rows[0];
      if (!source) throw new Error('PAYMENT_NOT_FOUND');
      if (source.status === 'succeeded') {
        await client.query('COMMIT');
        const order = await this.loadOrder(this.pool, orderId);
        if (!order) throw new Error('PAYMENT_NOT_FOUND');
        return order;
      }
      if (source.status !== 'processing')
        throw new Error('PAYMENT_NOT_PROCESSING');

      await client.query(
        'INSERT INTO loyalty_accounts (user_id) VALUES ($1) ON CONFLICT DO NOTHING',
        [source.user_id],
      );
      const account = await client.query<{ balance: number }>(
        'SELECT balance FROM loyalty_accounts WHERE user_id = $1 FOR UPDATE',
        [source.user_id],
      );
      const balanceAfter = account.rows[0]!.balance + source.total_points;
      await client.query(
        `INSERT INTO loyalty_ledger_entries (
           id, user_id, delta, entry_type, source_type, source_id,
           description, idempotency_key, balance_after, created_at
         ) VALUES ($1,$2,$3,'payment_credit','payment_order',$4,$5,$4,$6,$7)`,
        [
          randomUUID(),
          source.user_id,
          source.total_points,
          orderId,
          `order:${orderId}`,
          balanceAfter,
          now,
        ],
      );
      await client.query(
        `UPDATE loyalty_accounts
         SET balance = $2, version = version + 1, updated_at = $3 WHERE user_id = $1`,
        [source.user_id, balanceAfter, now],
      );
      await client.query(
        `UPDATE payment_orders SET status = 'succeeded', paid_at = $2, updated_at = $2
         WHERE id = $1`,
        [orderId, now],
      );
      await client.query(
        'UPDATE demo_payment_tokens SET consumed_at = $2 WHERE order_id = $1',
        [orderId, now],
      );
      await client.query(
        `INSERT INTO payment_simulation_events (id, order_id, step, idempotency_key, created_at)
         VALUES ($1,$2,'succeeded',$3,$4) ON CONFLICT DO NOTHING`,
        [randomUUID(), orderId, idempotencyKey, now],
      );
      await client.query(
        `INSERT INTO domain_outbox (id, event_type, aggregate_id, payload, created_at)
         VALUES
           ($1, 'payment.status.v1', $3, $5::jsonb, $4),
           ($2, 'loyalty.balance_changed.v1', $6, $7::jsonb, $4)`,
        [
          randomUUID(),
          randomUUID(),
          orderId,
          now,
          JSON.stringify({ orderId, status: 'succeeded' }),
          source.user_id,
          JSON.stringify({
            userId: source.user_id,
            delta: source.total_points,
            balance: balanceAfter,
            orderId,
          }),
        ],
      );
      await client.query('COMMIT');
      const order = await this.loadOrder(this.pool, orderId);
      if (!order) throw new Error('PAYMENT_NOT_FOUND');
      return order;
    } catch (error) {
      await this.safeRollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async failSimulation(
    orderId: string,
    idempotencyKey: string,
    now: Date,
  ): Promise<DemoPaymentOrder> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const state = await client.query<{ status: DemoPaymentOrder['status'] }>(
        'SELECT status FROM payment_orders WHERE id = $1 FOR UPDATE',
        [orderId],
      );
      const status = state.rows[0]?.status;
      if (!status) throw new Error('PAYMENT_NOT_FOUND');
      if (status === 'failed') {
        await client.query('COMMIT');
        const existing = await this.loadOrder(this.pool, orderId);
        if (!existing) throw new Error('PAYMENT_NOT_FOUND');
        return existing;
      }
      if (status !== 'processing') throw new Error('PAYMENT_NOT_PROCESSING');
      await client.query(
        `UPDATE payment_orders SET status = 'failed', updated_at = $2 WHERE id = $1`,
        [orderId, now],
      );
      await client.query(
        'UPDATE demo_payment_tokens SET consumed_at = $2 WHERE order_id = $1',
        [orderId, now],
      );
      await client.query(
        `INSERT INTO payment_simulation_events (id, order_id, step, idempotency_key, created_at)
         VALUES ($1,$2,'failed',$3,$4) ON CONFLICT DO NOTHING`,
        [randomUUID(), orderId, idempotencyKey, now],
      );
      await client.query(
        `INSERT INTO domain_outbox (id, event_type, aggregate_id, payload, created_at)
         VALUES ($1, 'payment.status.v1', $2, $3::jsonb, $4)`,
        [
          randomUUID(),
          orderId,
          JSON.stringify({ orderId, status: 'failed' }),
          now,
        ],
      );
      await client.query('COMMIT');
      const failed = await this.loadOrder(this.pool, orderId);
      if (!failed) throw new Error('PAYMENT_NOT_FOUND');
      return failed;
    } catch (error) {
      await this.safeRollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async cancelOrder(
    orderId: string,
    cashierId: string,
    now: Date,
  ): Promise<DemoPaymentOrder> {
    const result = await this.pool.query<{ id: string }>(
      `UPDATE payment_orders SET status = 'cancelled', updated_at = $3
       WHERE id = $1 AND cashier_id = $2 AND status = 'pending' RETURNING id`,
      [orderId, cashierId, now],
    );
    if (!result.rows[0]) throw new Error('PAYMENT_NOT_PENDING');
    const order = await this.loadOrder(this.pool, orderId);
    if (!order) throw new Error('PAYMENT_NOT_FOUND');
    return order;
  }

  async getLoyalty(userId: string): Promise<LoyaltyAccountSummary> {
    const account = await this.pool.query<{
      balance: number;
      phone_last4: string | null;
    }>(
      `SELECT la.balance, upi.phone_last4
       FROM loyalty_accounts la
       LEFT JOIN user_phone_identities upi ON upi.user_id = la.user_id
       WHERE la.user_id = $1`,
      [userId],
    );
    const row = account.rows[0];
    if (!row) throw new Error('LOYALTY_ACCOUNT_NOT_FOUND');
    const entries = await this.pool.query<{
      id: string;
      delta: number;
      entry_type: LoyaltyLedgerEntry['entryType'];
      description: string;
      balance_after: number;
      created_at: Date | string;
    }>(
      `SELECT id, delta, entry_type, description, balance_after, created_at
       FROM loyalty_ledger_entries WHERE user_id = $1
       ORDER BY created_at DESC LIMIT 50`,
      [userId],
    );
    return {
      userId,
      phoneMasked: row.phone_last4 ? `+84•••••${row.phone_last4}` : 'demo-user',
      balance: row.balance,
      entries: entries.rows.map((entry) => ({
        id: entry.id,
        delta: entry.delta,
        entryType: entry.entry_type,
        description: entry.description,
        balanceAfter: entry.balance_after,
        createdAt: new Date(entry.created_at).toISOString(),
      })),
    };
  }

  async listRewards(): Promise<RewardCatalogItem[]> {
    const result = await this.pool.query<{
      id: string;
      code: string;
      name: string;
      points_cost: number;
      active: boolean;
    }>(
      'SELECT id, code, name, points_cost, active FROM reward_catalog WHERE active = true ORDER BY points_cost, code',
    );
    return result.rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      pointsCost: row.points_cost,
      active: row.active,
    }));
  }

  async redeemReward(input: RedeemRewardRecord): Promise<RewardRedemption> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query<{
        id: string;
        reward_id: string;
        reward_name: string;
        points_cost: number;
        status: RewardRedemption['status'];
        fulfillment_code: string;
        created_at: Date | string;
      }>(
        `SELECT id, reward_id, reward_name, points_cost, status, fulfillment_code, created_at
         FROM reward_redemptions WHERE user_id = $1 AND idempotency_key = $2`,
        [input.userId, input.idempotencyKey],
      );
      if (existing.rows[0]) {
        await client.query('COMMIT');
        return this.mapRedemption(existing.rows[0]);
      }
      const reward = await client.query<{
        id: string;
        name: string;
        points_cost: number;
      }>(
        'SELECT id, name, points_cost FROM reward_catalog WHERE id = $1 AND active = true',
        [input.rewardId],
      );
      const selected = reward.rows[0];
      if (!selected) throw new Error('REWARD_NOT_FOUND');
      const account = await client.query<{ balance: number }>(
        'SELECT balance FROM loyalty_accounts WHERE user_id = $1 FOR UPDATE',
        [input.userId],
      );
      const balance = account.rows[0]?.balance ?? 0;
      if (balance < selected.points_cost)
        throw new Error('INSUFFICIENT_POINTS');
      const balanceAfter = balance - selected.points_cost;
      await client.query(
        `INSERT INTO reward_redemptions (
          id, user_id, reward_id, reward_name, points_cost, status,
          fulfillment_code, idempotency_key, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,'confirmed',$6,$7,$8,$8)`,
        [
          input.id,
          input.userId,
          selected.id,
          selected.name,
          selected.points_cost,
          input.fulfillmentCode,
          input.idempotencyKey,
          input.now,
        ],
      );
      await client.query(
        `INSERT INTO loyalty_ledger_entries (
           id, user_id, delta, entry_type, source_type, source_id,
           description, idempotency_key, balance_after, created_at
         ) VALUES ($1,$2,$3,'redemption_debit','reward_redemption',$4,$5,$6,$7,$8)`,
        [
          randomUUID(),
          input.userId,
          -selected.points_cost,
          input.id,
          `redemption:${input.id}`,
          input.idempotencyKey,
          balanceAfter,
          input.now,
        ],
      );
      await client.query(
        `UPDATE loyalty_accounts SET balance = $2, version = version + 1, updated_at = $3
         WHERE user_id = $1`,
        [input.userId, balanceAfter, input.now],
      );
      await client.query('COMMIT');
      return {
        id: input.id,
        rewardId: selected.id,
        rewardName: selected.name,
        pointsCost: selected.points_cost,
        status: 'confirmed',
        fulfillmentCode: input.fulfillmentCode,
        createdAt: input.now.toISOString(),
      };
    } catch (error) {
      await this.safeRollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async adjustLoyalty(input: LoyaltyAdjustmentRecord): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM loyalty_ledger_entries
         WHERE user_id = $1 AND idempotency_key = $2`,
        [input.userId, input.idempotencyKey],
      );
      if (existing.rows[0]) {
        await client.query('COMMIT');
        return;
      }
      const user = await client.query<{ id: string }>(
        `SELECT id FROM users WHERE id = $1 AND status = 'active'`,
        [input.userId],
      );
      if (!user.rows[0]) throw new Error('LOYALTY_ACCOUNT_NOT_FOUND');
      await client.query(
        `INSERT INTO loyalty_accounts (user_id) VALUES ($1)
         ON CONFLICT (user_id) DO NOTHING`,
        [input.userId],
      );
      const account = await client.query<{ balance: number }>(
        'SELECT balance FROM loyalty_accounts WHERE user_id = $1 FOR UPDATE',
        [input.userId],
      );
      const current = account.rows[0]?.balance ?? 0;
      const balanceAfter = current + input.delta;
      if (balanceAfter < 0) throw new Error('LOYALTY_BALANCE_NEGATIVE');
      await client.query(
        `INSERT INTO loyalty_ledger_entries (
           id, user_id, delta, entry_type, source_type, source_id,
           description, idempotency_key, balance_after, created_at
         ) VALUES ($1,$2,$3,'admin_adjustment','admin',$1,$4,$5,$6,$7)`,
        [
          input.id,
          input.userId,
          input.delta,
          input.reason,
          input.idempotencyKey,
          balanceAfter,
          input.now,
        ],
      );
      await client.query(
        `UPDATE loyalty_accounts
         SET balance = $2, version = version + 1, updated_at = $3
         WHERE user_id = $1`,
        [input.userId, balanceAfter, input.now],
      );
      await client.query(
        `INSERT INTO audit_logs (
           id, actor_id, action, entity_type, entity_id, before_json, after_json, created_at
         ) VALUES ($1,$2,'loyalty.adjust','user',$3,
           jsonb_build_object('balance', $4::integer),
           jsonb_build_object('balance', $5::integer, 'delta', $6::integer, 'reason', $7::text), $8)`,
        [
          randomUUID(),
          input.actorId,
          input.userId,
          current,
          balanceAfter,
          input.delta,
          input.reason,
          input.now,
        ],
      );
      await client.query('COMMIT');
    } catch (error) {
      await this.safeRollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async dashboardSummary(
    ranges: DashboardRanges,
    now: Date,
  ): Promise<DashboardSummary> {
    const result = await this.pool.query<{
      today_vnd: string;
      yesterday_vnd: string;
      week_vnd: string;
      month_vnd: string;
      paying_users_today: string;
      active_visitors_today: string;
    }>(
      `SELECT
         COALESCE(sum(total_amount_vnd) FILTER (WHERE paid_at >= $1 AND paid_at < $2), 0) AS today_vnd,
         COALESCE(sum(total_amount_vnd) FILTER (WHERE paid_at >= $3 AND paid_at < $4), 0) AS yesterday_vnd,
         COALESCE(sum(total_amount_vnd) FILTER (WHERE paid_at >= $5 AND paid_at < $6), 0) AS week_vnd,
         COALESCE(sum(total_amount_vnd) FILTER (WHERE paid_at >= $7 AND paid_at < $8), 0) AS month_vnd,
         count(DISTINCT user_id) FILTER (WHERE paid_at >= $1 AND paid_at < $2) AS paying_users_today,
         (SELECT count(DISTINCT user_id) FROM demo_customer_tokens WHERE created_at >= $1 AND created_at < $2) AS active_visitors_today
       FROM payment_orders
       WHERE status = 'succeeded'
         AND paid_at >= LEAST($1, $3, $5, $7)
         AND paid_at < GREATEST($2, $4, $6, $8)`,
      [
        ranges.today.from,
        ranges.today.to,
        ranges.yesterday.from,
        ranges.yesterday.to,
        ranges.week.from,
        ranges.week.to,
        ranges.month.from,
        ranges.month.to,
      ],
    );
    const row = result.rows[0]!;
    return {
      timezone: 'Asia/Ho_Chi_Minh',
      generatedAt: now.toISOString(),
      dataStatus: 'live',
      activeVisitorsToday: Number(row.active_visitors_today),
      payingUsersToday: Number(row.paying_users_today),
      onlineNow: 0,
      simulatedRevenue: {
        todayVnd: Number(row.today_vnd),
        yesterdayVnd: Number(row.yesterday_vnd),
        weekVnd: Number(row.week_vnd),
        monthVnd: Number(row.month_vnd),
      },
    };
  }

  async listRecentPayments(input: {
    limit: number;
    cursor?: { createdAt: Date; id: string };
  }): Promise<PaymentFeedPageRecord> {
    const values: unknown[] = [];
    const cursorWhere = input.cursor
      ? (() => {
          values.push(input.cursor.createdAt, input.cursor.id);
          return 'WHERE (po.created_at, po.id) < ($1, $2::uuid)';
        })()
      : '';
    values.push(input.limit + 1);
    const limitParameter = `$${values.length}`;
    const result = await this.pool.query<{
      id: string;
      status: AdminPaymentFeedItem['status'];
      phone_last4: string;
      total_amount_vnd: string;
      total_points: number;
      ticket_quantity: number;
      product_names: string[];
      created_at: Date | string;
      paid_at: Date | string | null;
    }>(
      `WITH recent AS MATERIALIZED (
         SELECT id, user_id, status, total_amount_vnd, total_points,
                created_at, paid_at
         FROM payment_orders po
         ${cursorWhere}
         ORDER BY po.created_at DESC, po.id DESC
         LIMIT ${limitParameter}
       )
       SELECT po.id, po.status, upi.phone_last4, po.total_amount_vnd,
              po.total_points, po.created_at, po.paid_at,
              COALESCE(sum(item.quantity), 0)::int AS ticket_quantity,
              COALESCE(
                array_agg(DISTINCT item.product_name ORDER BY item.product_name)
                  FILTER (WHERE item.product_name IS NOT NULL),
                ARRAY[]::varchar[]
              ) AS product_names
       FROM recent po
       JOIN user_phone_identities upi ON upi.user_id = po.user_id
       LEFT JOIN payment_order_items item ON item.order_id = po.id
       GROUP BY po.id, po.status, po.total_amount_vnd, po.total_points,
                po.created_at, po.paid_at, upi.phone_last4
       ORDER BY po.created_at DESC, po.id DESC
      `,
      values,
    );
    const hasMore = result.rows.length > input.limit;
    const items: AdminPaymentFeedItem[] = result.rows
      .slice(0, input.limit)
      .map((row) => ({
        id: row.id,
        status: row.status,
        phoneMasked: `+84•••••${row.phone_last4}`,
        totalAmountVnd: Number(row.total_amount_vnd),
        totalPoints: row.total_points,
        ticketQuantity: row.ticket_quantity,
        productNames: row.product_names,
        createdAt: new Date(row.created_at).toISOString(),
        ...(row.paid_at ? { paidAt: new Date(row.paid_at).toISOString() } : {}),
      }));
    const last = hasMore ? items.at(-1) : undefined;
    return {
      items,
      ...(last
        ? { nextCursor: { createdAt: new Date(last.createdAt), id: last.id } }
        : {}),
    };
  }

  async findPaidUserIds(
    userIds: string[],
    paidRange: { from: Date; to: Date },
  ): Promise<Set<string>> {
    if (userIds.length === 0) return new Set();
    const result = await this.pool.query<{ user_id: string }>(
      `SELECT DISTINCT user_id
       FROM payment_orders
       WHERE status = 'succeeded'
         AND user_id = ANY($1::uuid[])
         AND paid_at >= $2
         AND paid_at < $3`,
      [userIds, paidRange.from, paidRange.to],
    );
    return new Set(result.rows.map((row) => row.user_id));
  }

  private async loadOrder(
    client: Queryable,
    id: string,
  ): Promise<DemoPaymentOrder | null> {
    const orderResult = await client.query<OrderRow>(
      `SELECT po.id, po.user_id, po.status, upi.phone_last4,
              po.total_amount_vnd, po.total_points, po.qr_expires_at,
              po.created_at, po.processing_at, po.paid_at
       FROM payment_orders po
       JOIN user_phone_identities upi ON upi.user_id = po.user_id
       WHERE po.id = $1`,
      [id],
    );
    const order = orderResult.rows[0];
    if (!order) return null;
    const itemResult = await client.query<ItemRow>(
      `SELECT ticket_product_id, product_code, product_name, quantity,
              unit_amount_vnd, unit_points
       FROM payment_order_items WHERE order_id = $1 ORDER BY product_code`,
      [id],
    );
    const items: DemoPaymentOrderItem[] = itemResult.rows.map((item) => ({
      ticketProductId: item.ticket_product_id,
      code: item.product_code,
      name: item.product_name,
      quantity: item.quantity,
      unitAmountVnd: Number(item.unit_amount_vnd),
      unitPoints: item.unit_points,
      subtotalVnd: Number(item.unit_amount_vnd) * item.quantity,
      points: item.unit_points * item.quantity,
    }));
    return {
      id: order.id,
      status: order.status,
      phoneMasked: `+84•••••${order.phone_last4}`,
      items,
      totalAmountVnd: Number(order.total_amount_vnd),
      totalPoints: order.total_points,
      qrExpiresAt: new Date(order.qr_expires_at).toISOString(),
      createdAt: new Date(order.created_at).toISOString(),
      ...(order.processing_at
        ? { processingAt: new Date(order.processing_at).toISOString() }
        : {}),
      ...(order.paid_at
        ? { paidAt: new Date(order.paid_at).toISOString() }
        : {}),
    };
  }

  private mapRedemption(row: {
    id: string;
    reward_id: string;
    reward_name: string;
    points_cost: number;
    status: RewardRedemption['status'];
    fulfillment_code: string;
    created_at: Date | string;
  }): RewardRedemption {
    return {
      id: row.id,
      rewardId: row.reward_id,
      rewardName: row.reward_name,
      pointsCost: row.points_cost,
      status: row.status,
      fulfillmentCode: row.fulfillment_code,
      createdAt: new Date(row.created_at).toISOString(),
    };
  }

  private async safeRollback(client: OperationsClient): Promise<void> {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original failure.
    }
  }
}
