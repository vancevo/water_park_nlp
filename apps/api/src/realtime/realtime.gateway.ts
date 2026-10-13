import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';

import { AUTH_CLOCK, type AuthPrincipal } from '../auth/auth.models.js';
import { TokenService } from '../auth/token.service.js';
import { OperationsEvents } from '../operations/operations.events.js';
import { OperationsService } from '../operations/operations.service.js';

interface AuthenticatedSocket extends Socket {
  data: { principal?: AuthPrincipal };
}

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
@WebSocketGateway({
  namespace: '/realtime',
  cors: { origin: true, credentials: true },
  maxHttpBufferSize: 16 * 1024,
})
export class RealtimeGateway
  implements OnGatewayConnection, OnModuleInit, OnModuleDestroy
{
  @WebSocketServer()
  private server!: Server;

  private unsubscribe?: () => void;

  constructor(
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(AUTH_CLOCK) private readonly now: () => Date,
    @Inject(OperationsEvents) private readonly events: OperationsEvents,
    @Inject(OperationsService) private readonly operations: OperationsService,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.events.subscribe((notice) => {
      if (notice.userId) {
        this.server
          .to(`user:${notice.userId}`)
          .emit(notice.event.type, notice.event);
      }
      if (notice.orderId) {
        this.server
          .to(`order:${notice.orderId}`)
          .emit(notice.event.type, notice.event);
      }
      if (
        notice.event.type === 'dashboard.delta.v1' ||
        notice.event.type === 'presence.delta.v1'
      ) {
        this.server.to('operations').emit(notice.event.type, notice.event);
      }
      if (notice.event.type === 'visitor.presence.delta.v1') {
        this.server.to('visitors').emit(notice.event.type, notice.event);
      }
    });
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
  }

  handleConnection(socket: AuthenticatedSocket): void {
    try {
      const token = this.accessToken(socket);
      const principal = this.tokens.verifyAccess(token, this.now());
      socket.data.principal = principal;
      void socket.join(`user:${principal.userId}`);
      if (principal.roles.includes('VISITOR')) {
        void socket.join('visitors');
      }
      if (
        principal.roles.includes('ADMIN') ||
        principal.roles.includes('OPERATIONS')
      ) {
        void socket.join('operations');
      }
      socket.emit('realtime.ready.v1', {
        schemaVersion: 1,
        reconnectSnapshotRequired: true,
      });
    } catch {
      socket.disconnect(true);
    }
  }

  @SubscribeMessage('order.subscribe.v1')
  async subscribeOrder(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() body: unknown,
  ): Promise<{ ok: boolean; code?: string }> {
    const principal = socket.data.principal;
    if (!principal) return { ok: false, code: 'UNAUTHENTICATED' };
    if (
      !principal.roles.includes('CASHIER') &&
      !principal.roles.includes('ADMIN')
    ) {
      return { ok: false, code: 'FORBIDDEN' };
    }
    const orderId = this.orderId(body);
    if (!orderId) return { ok: false, code: 'INVALID_ORDER_ID' };
    if (!(await this.operations.canSubscribeOrder(orderId, principal))) {
      return { ok: false, code: 'FORBIDDEN' };
    }
    await socket.join(`order:${orderId}`);
    return { ok: true };
  }

  private accessToken(socket: Socket): string {
    const authToken = socket.handshake.auth?.token;
    if (typeof authToken === 'string' && authToken.length <= 4096) {
      return authToken;
    }
    const authorization = socket.handshake.headers.authorization;
    if (
      typeof authorization === 'string' &&
      authorization.startsWith('Bearer ') &&
      authorization.length <= 4103
    ) {
      return authorization.slice(7);
    }
    throw new Error('UNAUTHENTICATED');
  }

  private orderId(body: unknown): string | undefined {
    if (!body || typeof body !== 'object') return undefined;
    const orderId = (body as { orderId?: unknown }).orderId;
    return typeof orderId === 'string' && UUID_V4.test(orderId)
      ? orderId
      : undefined;
  }
}
