import { createHash, randomBytes, randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { loadRuntimeConfig } from '@damsen/config';
import type {
  CashierCustomerLookup,
  AdminPaymentFeedResponse,
  DashboardSummary,
  DemoPaymentOrder,
  LoyaltyAccountSummary,
  RewardCatalogItem,
  RewardRedemption,
  TicketProduct,
  UserRole,
} from '@damsen/shared-types';

import { AuthService } from '../auth/auth.service.js';
import type {
  ConfirmDemoPaymentDto,
  CreateDemoOrderDto,
  CreateRedemptionDto,
  CustomerLookupDto,
  LoyaltyAdjustmentDto,
} from './operations.dto.js';
import { OperationsEvents } from './operations.events.js';
import { PresenceService } from './presence.service.js';
import { dashboardRanges } from './dashboard-time.js';
import {
  decodePaymentFeedCursor,
  encodePaymentFeedCursor,
} from './payment-feed-cursor.js';
import {
  OPERATIONS_CLOCK,
  OPERATIONS_REPOSITORY,
  OPERATIONS_SLEEP,
  type OperationsRepository,
} from './operations.models.js';

const CUSTOMER_TOKEN_TTL_MS = 10 * 60 * 1000;
const QR_TTL_MS = 5 * 60 * 1000;
const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

@Injectable()
export class OperationsService {
  private readonly demo = loadRuntimeConfig().demo;

  constructor(
    @Inject(OPERATIONS_REPOSITORY)
    private readonly repository: OperationsRepository,
    @Inject(OPERATIONS_CLOCK) private readonly now: () => Date,
    @Inject(OPERATIONS_SLEEP)
    private readonly sleep: (milliseconds: number) => Promise<void>,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(OperationsEvents) private readonly events: OperationsEvents,
    @Inject(PresenceService) private readonly presence: PresenceService,
  ) {}

  listTicketProducts(): Promise<TicketProduct[]> {
    this.assertPaymentsEnabled();
    return this.repository.listTicketProducts();
  }

  async lookupCustomer(
    actorId: string,
    input: CustomerLookupDto,
  ): Promise<CashierCustomerLookup> {
    this.assertPaymentsEnabled();
    const user = await this.auth.resolveDemoPhoneUser(input.phone);
    if (!user.phoneMasked) throw new BadRequestException('Demo phone required');
    const token = randomBytes(32).toString('base64url');
    const now = this.now();
    const expiresAt = new Date(now.getTime() + CUSTOMER_TOKEN_TTL_MS);
    const pointsBalance = await this.repository.issueCustomerToken({
      tokenHash: sha256(token),
      actorId,
      userId: user.id,
      phoneMasked: user.phoneMasked,
      expiresAt,
      now,
    });
    return {
      customerToken: token,
      userId: user.id,
      phoneMasked: user.phoneMasked,
      pointsBalance,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async createOrder(
    cashierId: string,
    input: CreateDemoOrderDto,
  ): Promise<DemoPaymentOrder> {
    this.assertPaymentsEnabled();
    const qrToken = randomBytes(32).toString('base64url');
    const now = this.now();
    const qrExpiresAt = new Date(now.getTime() + QR_TTL_MS);
    const publicBase = (
      process.env.DEMO_PAYMENT_PUBLIC_BASE_URL ?? 'http://localhost:3003'
    ).replace(/\/$/, '');
    try {
      return await this.repository.createOrder({
        id: randomUUID(),
        cashierId,
        customerTokenHash: sha256(input.customerToken),
        idempotencyKey: input.idempotencyKey,
        items: input.items,
        qrTokenHash: sha256(qrToken),
        qrExpiresAt,
        qrUrl: `${publicBase}/demo-pay/${encodeURIComponent(qrToken)}`,
        now,
      });
    } catch (error) {
      this.rethrowDomain(error);
    }
  }

  async getCashierOrder(id: string): Promise<DemoPaymentOrder> {
    this.assertPaymentsEnabled();
    const order = await this.repository.findOrderById(id);
    if (!order) throw new NotFoundException('Demo payment order not found');
    return order;
  }

  async canSubscribeOrder(
    id: string,
    principal: { userId: string; roles: UserRole[] },
  ): Promise<boolean> {
    if (principal.roles.includes('ADMIN')) return true;
    return (await this.repository.findOrderCashierId(id)) === principal.userId;
  }

  async cancelOrder(id: string, cashierId: string): Promise<DemoPaymentOrder> {
    this.assertPaymentsEnabled();
    try {
      return await this.repository.cancelOrder(id, cashierId, this.now());
    } catch (error) {
      this.rethrowDomain(error);
    }
  }

  async getDemoOrder(token: string): Promise<DemoPaymentOrder> {
    this.assertPaymentsEnabled();
    const order = await this.repository.findOrderByQrToken(
      sha256(token),
      this.now(),
    );
    if (!order) throw new NotFoundException('Demo payment QR not found');
    return order;
  }

  async confirmDemoPayment(
    token: string,
    input: ConfirmDemoPaymentDto,
  ): Promise<DemoPaymentOrder> {
    this.assertPaymentsEnabled();
    let processing: DemoPaymentOrder;
    try {
      processing = await this.repository.beginSimulation(
        sha256(token),
        input.idempotencyKey,
        this.now(),
      );
    } catch (error) {
      this.rethrowDomain(error);
    }
    const userId = await this.repository.findOrderUserId(processing.id);
    this.events.publish({
      type: 'payment.status.v1',
      orderId: processing.id,
      ...(userId ? { userId } : {}),
      payload: processing,
    });
    if (processing.status === 'succeeded' || processing.status === 'failed') {
      return processing;
    }
    if (processing.status === 'processing') {
      await this.sleep(this.demo.paymentProcessingDelayMs);
    }
    let completed: DemoPaymentOrder;
    try {
      completed =
        input.simulateOutcome === 'failed'
          ? await this.repository.failSimulation(
              processing.id,
              input.idempotencyKey,
              this.now(),
            )
          : await this.repository.completeSimulation(
              processing.id,
              input.idempotencyKey,
              this.now(),
            );
    } catch (error) {
      this.rethrowDomain(error);
    }
    const loyalty = userId
      ? await this.repository.getLoyalty(userId)
      : undefined;
    this.events.publish({
      type: 'payment.status.v1',
      orderId: completed.id,
      ...(userId ? { userId } : {}),
      payload: completed,
    });
    if (completed.status === 'succeeded' && userId && loyalty) {
      this.events.publish({
        type: 'loyalty.balance_changed.v1',
        userId,
        orderId: completed.id,
        payload: {
          userId,
          orderId: completed.id,
          delta: completed.totalPoints,
          balance: loyalty.balance,
        },
      });
    }
    this.events.publish({
      type: 'dashboard.delta.v1',
      payload: { orderId: completed.id, status: completed.status },
    });
    return completed;
  }

  getLoyalty(userId: string): Promise<LoyaltyAccountSummary> {
    return this.repository.getLoyalty(userId);
  }

  listRewards(): Promise<RewardCatalogItem[]> {
    return this.repository.listRewards();
  }

  async adjustLoyalty(
    actorId: string,
    input: LoyaltyAdjustmentDto,
  ): Promise<LoyaltyAccountSummary> {
    try {
      await this.repository.adjustLoyalty({
        id: randomUUID(),
        actorId,
        userId: input.userId,
        delta: input.delta,
        reason: input.reason.trim(),
        idempotencyKey: input.idempotencyKey,
        now: this.now(),
      });
      const loyalty = await this.repository.getLoyalty(input.userId);
      this.events.publish({
        type: 'loyalty.balance_changed.v1',
        userId: input.userId,
        payload: {
          userId: input.userId,
          balance: loyalty.balance,
          adjustmentIdempotencyKey: input.idempotencyKey,
        },
      });
      return loyalty;
    } catch (error) {
      this.rethrowDomain(error);
    }
  }

  async redeemReward(
    userId: string,
    input: CreateRedemptionDto,
  ): Promise<RewardRedemption> {
    try {
      const redemption = await this.repository.redeemReward({
        id: randomUUID(),
        userId,
        rewardId: input.rewardId,
        idempotencyKey: input.idempotencyKey,
        fulfillmentCode: randomBytes(5).toString('hex').toUpperCase(),
        now: this.now(),
      });
      const loyalty = await this.repository.getLoyalty(userId);
      this.events.publish({
        type: 'loyalty.balance_changed.v1',
        userId,
        payload: {
          userId,
          balance: loyalty.balance,
          redemptionId: redemption.id,
        },
      });
      return redemption;
    } catch (error) {
      this.rethrowDomain(error);
    }
  }

  async dashboardSummary(): Promise<DashboardSummary> {
    const now = this.now();
    const summary = await this.repository.dashboardSummary(
      dashboardRanges(now),
      now,
    );
    return { ...summary, onlineNow: await this.presence.count() };
  }

  async recentPayments(input: {
    limit: number;
    cursor?: string;
  }): Promise<AdminPaymentFeedResponse> {
    const page = await this.repository.listRecentPayments({
      limit: input.limit,
      ...(input.cursor
        ? { cursor: decodePaymentFeedCursor(input.cursor) }
        : {}),
    });
    return {
      items: page.items,
      ...(page.nextCursor
        ? { nextCursor: encodePaymentFeedCursor(page.nextCursor) }
        : {}),
    };
  }

  private assertPaymentsEnabled(): void {
    if (!this.demo.enabled || !this.demo.paymentsEnabled) {
      throw new ServiceUnavailableException('Demo payments are disabled');
    }
  }

  private rethrowDomain(error: unknown): never {
    const code = error instanceof Error ? error.message : 'UNKNOWN';
    if (
      code === 'TICKET_PRODUCT_NOT_FOUND' ||
      code === 'REWARD_NOT_FOUND' ||
      code === 'PAYMENT_NOT_FOUND' ||
      code === 'PAYMENT_TOKEN_INVALID' ||
      code === 'LOYALTY_ACCOUNT_NOT_FOUND'
    ) {
      throw new NotFoundException(code);
    }
    if (
      code === 'CUSTOMER_TOKEN_INVALID' ||
      code === 'PAYMENT_NOT_PENDING' ||
      code === 'PAYMENT_NOT_PROCESSING' ||
      code === 'PAYMENT_TOKEN_CONSUMED' ||
      code === 'INSUFFICIENT_POINTS' ||
      code === 'DUPLICATE_TICKET_PRODUCT' ||
      code === 'LOYALTY_BALANCE_NEGATIVE'
    ) {
      throw new ConflictException(code);
    }
    throw error;
  }
}
