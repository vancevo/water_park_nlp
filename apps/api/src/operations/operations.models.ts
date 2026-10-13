import type {
  AdminPaymentFeedItem,
  DashboardSummary,
  DemoPaymentOrder,
  DemoPaymentOrderItemInput,
  LoyaltyAccountSummary,
  RewardCatalogItem,
  RewardRedemption,
  TicketProduct,
} from '@damsen/shared-types';

export interface CreateOrderRecord {
  id: string;
  cashierId: string;
  customerTokenHash: string;
  idempotencyKey: string;
  items: DemoPaymentOrderItemInput[];
  qrTokenHash: string;
  qrExpiresAt: Date;
  qrUrl: string;
  now: Date;
}

export interface RedeemRewardRecord {
  id: string;
  userId: string;
  rewardId: string;
  idempotencyKey: string;
  fulfillmentCode: string;
  now: Date;
}

export interface LoyaltyAdjustmentRecord {
  id: string;
  actorId: string;
  userId: string;
  delta: number;
  reason: string;
  idempotencyKey: string;
  now: Date;
}

export interface DashboardRanges {
  today: { from: Date; to: Date };
  yesterday: { from: Date; to: Date };
  week: { from: Date; to: Date };
  month: { from: Date; to: Date };
}

export interface PaymentFeedCursor {
  createdAt: Date;
  id: string;
}

export interface PaymentFeedPageRecord {
  items: AdminPaymentFeedItem[];
  nextCursor?: PaymentFeedCursor;
}

export interface OperationsRepository {
  listTicketProducts(): Promise<TicketProduct[]>;
  issueCustomerToken(input: {
    tokenHash: string;
    actorId: string;
    userId: string;
    phoneMasked: string;
    expiresAt: Date;
    now: Date;
  }): Promise<number>;
  createOrder(input: CreateOrderRecord): Promise<DemoPaymentOrder>;
  findOrderById(id: string): Promise<DemoPaymentOrder | null>;
  findOrderUserId(id: string): Promise<string | null>;
  findOrderCashierId(id: string): Promise<string | null>;
  findOrderByQrToken(
    tokenHash: string,
    now: Date,
  ): Promise<DemoPaymentOrder | null>;
  beginSimulation(
    tokenHash: string,
    idempotencyKey: string,
    now: Date,
  ): Promise<DemoPaymentOrder>;
  completeSimulation(
    orderId: string,
    idempotencyKey: string,
    now: Date,
  ): Promise<DemoPaymentOrder>;
  failSimulation(
    orderId: string,
    idempotencyKey: string,
    now: Date,
  ): Promise<DemoPaymentOrder>;
  cancelOrder(
    orderId: string,
    cashierId: string,
    now: Date,
  ): Promise<DemoPaymentOrder>;
  getLoyalty(userId: string): Promise<LoyaltyAccountSummary>;
  listRewards(): Promise<RewardCatalogItem[]>;
  redeemReward(input: RedeemRewardRecord): Promise<RewardRedemption>;
  adjustLoyalty(input: LoyaltyAdjustmentRecord): Promise<void>;
  dashboardSummary(
    ranges: DashboardRanges,
    now: Date,
  ): Promise<DashboardSummary>;
  listRecentPayments(input: {
    limit: number;
    cursor?: PaymentFeedCursor;
  }): Promise<PaymentFeedPageRecord>;
  findPaidUserIds(
    userIds: string[],
    paidRange: { from: Date; to: Date },
  ): Promise<Set<string>>;
}

export const OPERATIONS_REPOSITORY = Symbol('OPERATIONS_REPOSITORY');
export const OPERATIONS_CLOCK = Symbol('OPERATIONS_CLOCK');
export const OPERATIONS_SLEEP = Symbol('OPERATIONS_SLEEP');
