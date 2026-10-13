import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import type {
  CashierCustomerLookup,
  AdminPaymentFeedResponse,
  DashboardSummary,
  DashboardTraffic,
  AdminPresenceSnapshot,
  VisitorPresenceSnapshot,
  PresenceSession,
  DemoPaymentOrder,
  LoyaltyAccountSummary,
  RewardCatalogItem,
  RewardRedemption,
  TicketProduct,
} from '@damsen/shared-types';

import {
  AccessTokenGuard,
  Roles,
  RolesGuard,
  type AuthenticatedRequest,
} from '../auth/rbac.js';
import {
  ConfirmDemoPaymentDto,
  CreateDemoOrderDto,
  CreateRedemptionDto,
  CustomerLookupDto,
  LoyaltyAdjustmentDto,
  PresenceLocationDto,
  RecentPaymentsQueryDto,
  StartPresenceSessionDto,
} from './operations.dto.js';
import { OperationsService } from './operations.service.js';
import { PresenceService } from './presence.service.js';

const bodyPipe = <T>(expectedType: new () => T) =>
  new ValidationPipe({
    expectedType,
    forbidNonWhitelisted: true,
    transform: true,
    whitelist: true,
  });

@Controller('v1/cashier')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles('CASHIER', 'ADMIN')
export class CashierOperationsController {
  constructor(
    @Inject(OperationsService) private readonly operations: OperationsService,
  ) {}

  @Get('ticket-products')
  listTicketProducts(): Promise<TicketProduct[]> {
    return this.operations.listTicketProducts();
  }

  @Post('customer-lookups')
  @HttpCode(200)
  lookupCustomer(
    @Req() request: AuthenticatedRequest,
    @Body(bodyPipe(CustomerLookupDto)) input: CustomerLookupDto,
  ): Promise<CashierCustomerLookup> {
    return this.operations.lookupCustomer(request.principal!.userId, input);
  }

  @Post('payment-orders')
  createOrder(
    @Req() request: AuthenticatedRequest,
    @Body(bodyPipe(CreateDemoOrderDto)) input: CreateDemoOrderDto,
  ): Promise<DemoPaymentOrder> {
    return this.operations.createOrder(request.principal!.userId, input);
  }

  @Get('payment-orders/:id')
  getOrder(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<DemoPaymentOrder> {
    return this.operations.getCashierOrder(id);
  }

  @Post('payment-orders/:id/cancel')
  @HttpCode(200)
  cancelOrder(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<DemoPaymentOrder> {
    return this.operations.cancelOrder(id, request.principal!.userId);
  }
}

@Controller('v1/admin/loyalty-adjustments')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles('ADMIN')
export class AdminLoyaltyController {
  constructor(
    @Inject(OperationsService) private readonly operations: OperationsService,
  ) {}

  @Post()
  @HttpCode(200)
  adjust(
    @Req() request: AuthenticatedRequest,
    @Body(bodyPipe(LoyaltyAdjustmentDto)) input: LoyaltyAdjustmentDto,
  ): Promise<LoyaltyAccountSummary> {
    return this.operations.adjustLoyalty(request.principal!.userId, input);
  }
}

@Controller('v1/demo-payments')
export class DemoPaymentController {
  constructor(
    @Inject(OperationsService) private readonly operations: OperationsService,
  ) {}

  @Get(':token')
  getOrder(@Param('token') token: string): Promise<DemoPaymentOrder> {
    return this.operations.getDemoOrder(token);
  }

  @Post(':token/confirm')
  @HttpCode(200)
  confirm(
    @Param('token') token: string,
    @Body(bodyPipe(ConfirmDemoPaymentDto)) input: ConfirmDemoPaymentDto,
  ): Promise<DemoPaymentOrder> {
    return this.operations.confirmDemoPayment(token, input);
  }
}

@Controller('v1')
export class LoyaltyController {
  constructor(
    @Inject(OperationsService) private readonly operations: OperationsService,
  ) {}

  @Get('rewards')
  listRewards(): Promise<RewardCatalogItem[]> {
    return this.operations.listRewards();
  }

  @Get('me/loyalty')
  @UseGuards(AccessTokenGuard)
  getLoyalty(
    @Req() request: AuthenticatedRequest,
  ): Promise<LoyaltyAccountSummary> {
    return this.operations.getLoyalty(request.principal!.userId);
  }

  @Post('me/reward-redemptions')
  @UseGuards(AccessTokenGuard)
  redeem(
    @Req() request: AuthenticatedRequest,
    @Body(bodyPipe(CreateRedemptionDto)) input: CreateRedemptionDto,
  ): Promise<RewardRedemption> {
    return this.operations.redeemReward(request.principal!.userId, input);
  }
}

@Controller('v1/admin/dashboard')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles('OPERATIONS', 'ADMIN')
export class OperationsDashboardController {
  constructor(
    @Inject(OperationsService) private readonly operations: OperationsService,
    @Inject(PresenceService) private readonly presence: PresenceService,
  ) {}

  @Get('summary')
  getSummary(): Promise<DashboardSummary> {
    return this.operations.dashboardSummary();
  }

  @Get('traffic')
  getTraffic(): Promise<DashboardTraffic> {
    return this.presence.traffic();
  }

  @Get('recent-payments')
  getRecentPayments(
    @Query(bodyPipe(RecentPaymentsQueryDto)) query: RecentPaymentsQueryDto,
  ): Promise<AdminPaymentFeedResponse> {
    return this.operations.recentPayments(query);
  }
}

@Controller('v1/me/presence/sessions')
@UseGuards(AccessTokenGuard)
export class PresenceController {
  constructor(
    @Inject(PresenceService) private readonly presence: PresenceService,
  ) {}

  @Post()
  start(
    @Req() request: AuthenticatedRequest,
    @Body(bodyPipe(StartPresenceSessionDto)) input: StartPresenceSessionDto,
  ): Promise<PresenceSession> {
    return this.presence.start(request.principal!.userId, input);
  }

  @Post(':id/locations')
  @HttpCode(204)
  update(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(bodyPipe(PresenceLocationDto)) input: PresenceLocationDto,
  ): Promise<void> {
    return this.presence.update(request.principal!.userId, id, input);
  }

  @Delete(':id')
  @HttpCode(204)
  stop(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<void> {
    return this.presence.stop(request.principal!.userId, id);
  }
}

@Controller('v1/me/nearby-presence')
@UseGuards(AccessTokenGuard)
export class VisitorPresenceController {
  constructor(
    @Inject(PresenceService) private readonly presence: PresenceService,
  ) {}

  @Get()
  snapshot(): Promise<VisitorPresenceSnapshot> {
    return this.presence.visitorSnapshot();
  }
}

@Controller('v1/admin/presence')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles('OPERATIONS', 'ADMIN')
export class AdminPresenceController {
  constructor(
    @Inject(PresenceService) private readonly presence: PresenceService,
  ) {}

  @Get()
  snapshot(): Promise<AdminPresenceSnapshot> {
    return this.presence.snapshot();
  }
}
