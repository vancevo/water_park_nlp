import { randomUUID } from 'node:crypto';

import type {
  AdminPaymentFeedItem,
  DashboardSummary,
  DemoPaymentOrder,
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

interface CustomerTokenRecord {
  userId: string;
  phoneMasked: string;
  expiresAt: Date;
  consumedAt?: Date;
  createdAt: Date;
}

interface StoredOrder extends DemoPaymentOrder {
  userId: string;
  cashierId: string;
  idempotencyKey: string;
  qrTokenHash: string;
  simulationIdempotencyKey?: string;
}

const PRODUCTS: TicketProduct[] = [
  {
    id: '20000000-0000-4000-8000-000000000001',
    code: 'DEMO_ADULT',
    name: 'Vé demo người lớn',
    amountVnd: 200_000,
    pointsPerItem: 200,
    active: true,
  },
  {
    id: '20000000-0000-4000-8000-000000000002',
    code: 'DEMO_CHILD',
    name: 'Vé demo trẻ em',
    amountVnd: 120_000,
    pointsPerItem: 120,
    active: true,
  },
  {
    id: '20000000-0000-4000-8000-000000000003',
    code: 'DEMO_COMBO',
    name: 'Vé demo combo',
    amountVnd: 300_000,
    pointsPerItem: 350,
    active: true,
  },
];

const REWARDS: RewardCatalogItem[] = [
  {
    id: '22000000-0000-4000-8000-000000000001',
    code: 'DEMO_DRINK',
    name: 'Nước uống demo',
    pointsCost: 100,
    active: true,
  },
  {
    id: '22000000-0000-4000-8000-000000000002',
    code: 'DEMO_GIFT',
    name: 'Quà lưu niệm demo',
    pointsCost: 300,
    active: true,
  },
];

export class InMemoryOperationsRepository implements OperationsRepository {
  private readonly customerTokens = new Map<string, CustomerTokenRecord>();
  private readonly orders = new Map<string, StoredOrder>();
  private readonly orderIdempotency = new Map<string, string>();
  private readonly loyaltyBalances = new Map<string, number>();
  private readonly phoneMasks = new Map<string, string>();
  private readonly ledger = new Map<string, LoyaltyLedgerEntry[]>();
  private readonly redemptions = new Map<string, RewardRedemption>();
  private readonly redemptionIdempotency = new Map<string, string>();
  private readonly adjustmentIdempotency = new Set<string>();
  private readonly auditLog: Array<{
    actorId: string;
    action: string;
    entityId: string;
  }> = [];

  async listTicketProducts(): Promise<TicketProduct[]> {
    return structuredClone(PRODUCTS.filter((item) => item.active));
  }

  async issueCustomerToken(input: {
    tokenHash: string;
    actorId: string;
    userId: string;
    phoneMasked: string;
    expiresAt: Date;
    now: Date;
  }): Promise<number> {
    this.customerTokens.set(input.tokenHash, {
      userId: input.userId,
      phoneMasked: input.phoneMasked,
      expiresAt: input.expiresAt,
      createdAt: input.now,
    });
    this.phoneMasks.set(input.userId, input.phoneMasked);
    this.auditLog.push({
      actorId: input.actorId,
      action: 'customer.lookup',
      entityId: input.userId,
    });
    return this.loyaltyBalances.get(input.userId) ?? 0;
  }

  async createOrder(input: CreateOrderRecord): Promise<DemoPaymentOrder> {
    const idemKey = `${input.cashierId}:${input.idempotencyKey}`;
    const existingId = this.orderIdempotency.get(idemKey);
    if (existingId) return this.publicOrder(this.orders.get(existingId)!);

    const customer = this.customerTokens.get(input.customerTokenHash);
    if (!customer || customer.consumedAt || customer.expiresAt <= input.now) {
      throw new Error('CUSTOMER_TOKEN_INVALID');
    }
    const seen = new Set<string>();
    const items = input.items.map((requested) => {
      if (seen.has(requested.ticketProductId)) {
        throw new Error('DUPLICATE_TICKET_PRODUCT');
      }
      seen.add(requested.ticketProductId);
      const product = PRODUCTS.find(
        (candidate) =>
          candidate.id === requested.ticketProductId && candidate.active,
      );
      if (!product) throw new Error('TICKET_PRODUCT_NOT_FOUND');
      return {
        ticketProductId: product.id,
        code: product.code,
        name: product.name,
        quantity: requested.quantity,
        unitAmountVnd: product.amountVnd,
        unitPoints: product.pointsPerItem,
        subtotalVnd: product.amountVnd * requested.quantity,
        points: product.pointsPerItem * requested.quantity,
      };
    });
    customer.consumedAt = input.now;
    const order: StoredOrder = {
      id: input.id,
      userId: customer.userId,
      cashierId: input.cashierId,
      idempotencyKey: input.idempotencyKey,
      qrTokenHash: input.qrTokenHash,
      status: 'pending',
      phoneMasked: customer.phoneMasked,
      items,
      totalAmountVnd: items.reduce((sum, item) => sum + item.subtotalVnd, 0),
      totalPoints: items.reduce((sum, item) => sum + item.points, 0),
      qrExpiresAt: input.qrExpiresAt.toISOString(),
      createdAt: input.now.toISOString(),
      qrUrl: input.qrUrl,
    };
    this.orders.set(order.id, order);
    this.orderIdempotency.set(idemKey, order.id);
    return this.publicOrder(order);
  }

  async findOrderById(id: string): Promise<DemoPaymentOrder | null> {
    const order = this.orders.get(id);
    return order ? this.publicOrder(order) : null;
  }

  async findOrderUserId(id: string): Promise<string | null> {
    return this.orders.get(id)?.userId ?? null;
  }

  async findOrderCashierId(id: string): Promise<string | null> {
    return this.orders.get(id)?.cashierId ?? null;
  }

  async findOrderByQrToken(
    tokenHash: string,
    now: Date,
  ): Promise<DemoPaymentOrder | null> {
    const order = [...this.orders.values()].find(
      (candidate) => candidate.qrTokenHash === tokenHash,
    );
    if (!order) return null;
    if (order.status === 'pending' && new Date(order.qrExpiresAt) <= now) {
      order.status = 'expired';
    }
    return this.publicOrder(order, false);
  }

  async beginSimulation(
    tokenHash: string,
    idempotencyKey: string,
    now: Date,
  ): Promise<DemoPaymentOrder> {
    const order = [...this.orders.values()].find(
      (candidate) => candidate.qrTokenHash === tokenHash,
    );
    if (!order) throw new Error('PAYMENT_TOKEN_INVALID');
    if (
      ['succeeded', 'failed', 'processing'].includes(order.status) &&
      order.simulationIdempotencyKey === idempotencyKey
    ) {
      return this.publicOrder(order, false);
    }
    if (['succeeded', 'failed', 'processing'].includes(order.status)) {
      throw new Error('PAYMENT_TOKEN_CONSUMED');
    }
    if (order.status !== 'pending' || new Date(order.qrExpiresAt) <= now) {
      if (order.status === 'pending') order.status = 'expired';
      throw new Error('PAYMENT_NOT_PENDING');
    }
    order.status = 'processing';
    order.simulationIdempotencyKey = idempotencyKey;
    order.processingAt = now.toISOString();
    return this.publicOrder(order, false);
  }

  async completeSimulation(
    orderId: string,
    _idempotencyKey: string,
    now: Date,
  ): Promise<DemoPaymentOrder> {
    const order = this.orders.get(orderId);
    if (!order) throw new Error('PAYMENT_NOT_FOUND');
    if (order.status === 'succeeded') return this.publicOrder(order, false);
    if (order.status !== 'processing')
      throw new Error('PAYMENT_NOT_PROCESSING');

    const balance =
      (this.loyaltyBalances.get(order.userId) ?? 0) + order.totalPoints;
    this.loyaltyBalances.set(order.userId, balance);
    const entries = this.ledger.get(order.userId) ?? [];
    if (!entries.some((entry) => entry.description === `order:${order.id}`)) {
      entries.unshift({
        id: randomUUID(),
        delta: order.totalPoints,
        entryType: 'payment_credit',
        description: `order:${order.id}`,
        balanceAfter: balance,
        createdAt: now.toISOString(),
      });
      this.ledger.set(order.userId, entries);
    }
    order.status = 'succeeded';
    order.paidAt = now.toISOString();
    return this.publicOrder(order, false);
  }

  async failSimulation(
    orderId: string,
    _idempotencyKey: string,
    now: Date,
  ): Promise<DemoPaymentOrder> {
    const order = this.orders.get(orderId);
    if (!order) throw new Error('PAYMENT_NOT_FOUND');
    if (order.status === 'failed') return this.publicOrder(order, false);
    if (order.status !== 'processing') {
      throw new Error('PAYMENT_NOT_PROCESSING');
    }
    order.status = 'failed';
    order.processingAt ??= now.toISOString();
    return this.publicOrder(order, false);
  }

  async cancelOrder(
    orderId: string,
    cashierId: string,
  ): Promise<DemoPaymentOrder> {
    const order = this.orders.get(orderId);
    if (!order) throw new Error('PAYMENT_NOT_FOUND');
    if (order.cashierId !== cashierId) throw new Error('PAYMENT_FORBIDDEN');
    if (order.status !== 'pending') throw new Error('PAYMENT_NOT_PENDING');
    order.status = 'cancelled';
    return this.publicOrder(order);
  }

  async getLoyalty(userId: string): Promise<LoyaltyAccountSummary> {
    return {
      userId,
      phoneMasked: this.phoneMasks.get(userId) ?? 'demo-user',
      balance: this.loyaltyBalances.get(userId) ?? 0,
      entries: structuredClone(this.ledger.get(userId) ?? []),
    };
  }

  async listRewards(): Promise<RewardCatalogItem[]> {
    return structuredClone(REWARDS.filter((reward) => reward.active));
  }

  async redeemReward(input: RedeemRewardRecord): Promise<RewardRedemption> {
    const idemKey = `${input.userId}:${input.idempotencyKey}`;
    const existing = this.redemptionIdempotency.get(idemKey);
    if (existing) return structuredClone(this.redemptions.get(existing)!);
    const reward = REWARDS.find(
      (candidate) => candidate.id === input.rewardId && candidate.active,
    );
    if (!reward) throw new Error('REWARD_NOT_FOUND');
    const current = this.loyaltyBalances.get(input.userId) ?? 0;
    if (current < reward.pointsCost) throw new Error('INSUFFICIENT_POINTS');
    const balance = current - reward.pointsCost;
    this.loyaltyBalances.set(input.userId, balance);
    const redemption: RewardRedemption = {
      id: input.id,
      rewardId: reward.id,
      rewardName: reward.name,
      pointsCost: reward.pointsCost,
      status: 'confirmed',
      fulfillmentCode: input.fulfillmentCode,
      createdAt: input.now.toISOString(),
    };
    this.redemptions.set(redemption.id, redemption);
    this.redemptionIdempotency.set(idemKey, redemption.id);
    const entries = this.ledger.get(input.userId) ?? [];
    entries.unshift({
      id: randomUUID(),
      delta: -reward.pointsCost,
      entryType: 'redemption_debit',
      description: `redemption:${redemption.id}`,
      balanceAfter: balance,
      createdAt: input.now.toISOString(),
    });
    this.ledger.set(input.userId, entries);
    return structuredClone(redemption);
  }

  async adjustLoyalty(input: LoyaltyAdjustmentRecord): Promise<void> {
    const key = `${input.userId}:${input.idempotencyKey}`;
    if (this.adjustmentIdempotency.has(key)) return;
    if (!this.phoneMasks.has(input.userId)) {
      throw new Error('LOYALTY_ACCOUNT_NOT_FOUND');
    }
    const current = this.loyaltyBalances.get(input.userId) ?? 0;
    const balance = current + input.delta;
    if (balance < 0) throw new Error('LOYALTY_BALANCE_NEGATIVE');
    this.loyaltyBalances.set(input.userId, balance);
    const entries = this.ledger.get(input.userId) ?? [];
    entries.unshift({
      id: input.id,
      delta: input.delta,
      entryType: 'admin_adjustment',
      description: input.reason,
      balanceAfter: balance,
      createdAt: input.now.toISOString(),
    });
    this.ledger.set(input.userId, entries);
    this.adjustmentIdempotency.add(key);
    this.auditLog.push({
      actorId: input.actorId,
      action: 'loyalty.adjust',
      entityId: input.userId,
    });
  }

  async dashboardSummary(
    ranges: DashboardRanges,
    now: Date,
  ): Promise<DashboardSummary> {
    const succeeded = [...this.orders.values()].filter(
      (order) => order.status === 'succeeded' && order.paidAt,
    );
    const revenue = (range: { from: Date; to: Date }) =>
      succeeded
        .filter((order) => {
          const paidAt = new Date(order.paidAt!);
          return paidAt >= range.from && paidAt < range.to;
        })
        .reduce((sum, order) => sum + order.totalAmountVnd, 0);
    const todayOrders = succeeded.filter((order) => {
      const paidAt = new Date(order.paidAt!);
      return paidAt >= ranges.today.from && paidAt < ranges.today.to;
    });
    const activeVisitors = new Set(
      [...this.customerTokens.values()]
        .filter(
          (token) =>
            token.createdAt >= ranges.today.from &&
            token.createdAt < ranges.today.to,
        )
        .map((token) => token.userId),
    );
    return {
      timezone: 'Asia/Ho_Chi_Minh',
      generatedAt: now.toISOString(),
      dataStatus: 'live',
      activeVisitorsToday: activeVisitors.size,
      payingUsersToday: new Set(todayOrders.map((order) => order.userId)).size,
      onlineNow: 0,
      simulatedRevenue: {
        todayVnd: revenue(ranges.today),
        yesterdayVnd: revenue(ranges.yesterday),
        weekVnd: revenue(ranges.week),
        monthVnd: revenue(ranges.month),
      },
    };
  }

  async listRecentPayments(input: {
    limit: number;
    cursor?: { createdAt: Date; id: string };
  }): Promise<PaymentFeedPageRecord> {
    const ordered = [...this.orders.values()]
      .filter((order) => {
        if (!input.cursor) return true;
        const createdAt = new Date(order.createdAt);
        return (
          createdAt < input.cursor.createdAt ||
          (createdAt.getTime() === input.cursor.createdAt.getTime() &&
            order.id < input.cursor.id)
        );
      })
      .sort(
        (left, right) =>
          new Date(right.createdAt).getTime() -
            new Date(left.createdAt).getTime() ||
          right.id.localeCompare(left.id),
      );
    const hasMore = ordered.length > input.limit;
    const items: AdminPaymentFeedItem[] = ordered
      .slice(0, input.limit)
      .map((order) => ({
        id: order.id,
        status: order.status,
        phoneMasked: order.phoneMasked,
        totalAmountVnd: order.totalAmountVnd,
        totalPoints: order.totalPoints,
        ticketQuantity: order.items.reduce(
          (sum, item) => sum + item.quantity,
          0,
        ),
        productNames: [...new Set(order.items.map((item) => item.name))].sort(),
        createdAt: order.createdAt,
        ...(order.paidAt ? { paidAt: order.paidAt } : {}),
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
    const requested = new Set(userIds);
    return new Set(
      [...this.orders.values()]
        .filter(
          (order) =>
            order.status === 'succeeded' && requested.has(order.userId),
        )
        .filter((order) => {
          if (!order.paidAt) return false;
          const paidAt = new Date(order.paidAt);
          return paidAt >= paidRange.from && paidAt < paidRange.to;
        })
        .map((order) => order.userId),
    );
  }

  private publicOrder(
    order: StoredOrder,
    includeQrUrl = true,
  ): DemoPaymentOrder {
    const clone = structuredClone(order);
    delete (clone as Partial<StoredOrder>).userId;
    delete (clone as Partial<StoredOrder>).cashierId;
    delete (clone as Partial<StoredOrder>).idempotencyKey;
    delete (clone as Partial<StoredOrder>).qrTokenHash;
    if (!includeQrUrl) delete clone.qrUrl;
    return clone;
  }
}
