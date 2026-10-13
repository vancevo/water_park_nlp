import { randomUUID } from 'node:crypto';

import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { loadRuntimeConfig } from '@damsen/config';
import type {
  AdminPresencePoint,
  AdminPresenceSnapshot,
  DashboardTraffic,
  PresenceSession,
  VisitorPresencePoint,
  VisitorPresenceSnapshot,
} from '@damsen/shared-types';

import type {
  PresenceLocationDto,
  StartPresenceSessionDto,
} from './operations.dto.js';
import { OperationsEvents } from './operations.events.js';
import {
  PRESENCE_STORE,
  PRESENCE_TTL_SECONDS,
  type LivePresence,
  type PresenceStore,
} from './presence.store.js';
import {
  dashboardRanges,
  isOperatingBucket,
  operatingHours,
} from './dashboard-time.js';
import {
  OPERATIONS_CLOCK,
  OPERATIONS_REPOSITORY,
  type OperationsRepository,
} from './operations.models.js';

const TTL_MS = PRESENCE_TTL_SECONDS * 1_000;
const BUCKET_MS = 15 * 60_000;
const MIN_UPDATE_INTERVAL_MS = 750;

@Injectable()
export class PresenceService implements OnModuleDestroy {
  private readonly demo = loadRuntimeConfig().demo;
  private readonly hours = operatingHours();

  constructor(
    @Inject(PRESENCE_STORE) private readonly store: PresenceStore,
    @Inject(OperationsEvents) private readonly events: OperationsEvents,
    @Inject(OPERATIONS_REPOSITORY)
    private readonly repository: OperationsRepository,
    @Inject(OPERATIONS_CLOCK) private readonly now: () => Date,
  ) {}

  async start(
    userId: string,
    input: StartPresenceSessionDto,
  ): Promise<PresenceSession> {
    this.assertEnabled();
    const id = randomUUID();
    const suffix = id.slice(0, 4).toUpperCase();
    const session: LivePresence = {
      id,
      userId,
      pseudonym: input.shareIdentity ? `Khách ${suffix}` : `Ẩn danh ${suffix}`,
      avatarVariant: Number.parseInt(id.slice(0, 2), 16) % 8,
      shareIdentity: input.shareIdentity ?? false,
      visibleToVisitors: input.visibleToVisitors ?? false,
      locationMode: input.locationMode ?? 'shared',
      lastSequence: 0,
      updatedAt: new Date().toISOString(),
    };
    await this.store.save(session);
    return {
      id,
      pseudonym: session.pseudonym,
      avatarVariant: session.avatarVariant,
      expiresInSeconds: TTL_MS / 1_000,
    };
  }

  async update(
    userId: string,
    sessionId: string,
    input: PresenceLocationDto,
  ): Promise<void> {
    this.assertEnabled();
    if (input.sessionId !== sessionId) {
      throw new ForbiddenException('Presence session mismatch');
    }
    const session = await this.ownedSession(userId, sessionId);
    if (input.sequence <= session.lastSequence) {
      throw new ConflictException('Presence sequence must increase');
    }
    if (
      session.lastLocationAt &&
      Date.now() - new Date(session.lastLocationAt).getTime() <
        MIN_UPDATE_INTERVAL_MS
    ) {
      throw new HttpException(
        'Presence update rate exceeded',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const occurredAt = new Date(input.occurredAt);
    if (Math.abs(Date.now() - occurredAt.getTime()) > 2 * 60_000) {
      throw new ForbiddenException('Presence update timestamp is stale');
    }
    session.lastSequence = input.sequence;
    session.lastLocationAt = new Date().toISOString();
    session.latitude = input.latitude;
    session.longitude = input.longitude;
    session.accuracyMeters = input.accuracyMeters;
    session.destinationPoiId = input.destinationPoiId;
    session.updatedAt = new Date().toISOString();
    const bucket =
      Math.floor(new Date(session.updatedAt).getTime() / BUCKET_MS) * BUCKET_MS;
    await this.store.save(session);
    await this.store.recordTraffic(bucket, sessionId);
    const paidUsers = await this.findPaidUsers([userId]);
    const point = this.toPoint(session, paidUsers.has(userId));
    if (point) {
      this.events.publish({
        type: 'presence.delta.v1',
        payload: point,
      });
    }
    const visitorPoint = this.toVisitorPoint(session);
    if (visitorPoint) {
      this.events.publish({
        type: 'visitor.presence.delta.v1',
        payload: visitorPoint,
      });
    }
  }

  async stop(userId: string, sessionId: string): Promise<void> {
    const session = await this.ownedSession(userId, sessionId);
    await this.store.remove(sessionId);
    this.events.publish({
      type: 'presence.delta.v1',
      payload: { sessionId, removed: true },
    });
    if (session.visibleToVisitors) {
      this.events.publish({
        type: 'visitor.presence.delta.v1',
        payload: { presenceId: sessionId, removed: true },
      });
    }
  }

  async count(): Promise<number> {
    return (await this.store.list()).filter(
      (item) => item.latitude !== undefined,
    ).length;
  }

  async snapshot(): Promise<AdminPresenceSnapshot> {
    const sessions = await this.store.list();
    const paidUsers = await this.findPaidUsers([
      ...new Set(sessions.map((item) => item.userId)),
    ]);
    return {
      generatedAt: new Date().toISOString(),
      items: sessions.flatMap((item) => {
        const point = this.toPoint(item, paidUsers.has(item.userId));
        return point ? [point] : [];
      }),
    };
  }

  async visitorSnapshot(): Promise<VisitorPresenceSnapshot> {
    return {
      generatedAt: new Date().toISOString(),
      items: (await this.store.list()).flatMap((item) => {
        const point = this.toVisitorPoint(item);
        return point ? [point] : [];
      }),
    };
  }

  async traffic(): Promise<DashboardTraffic> {
    const historyCutoff = Date.now() - 31 * 24 * 60 * 60_000;
    const items = (await this.store.traffic(historyCutoff))
      .filter((item) => isOperatingBucket(item.startsAt, this.hours))
      .sort((left, right) => left.startsAt - right.startsAt)
      .map(({ startsAt, count }) => ({
        startsAt: new Date(startsAt).toISOString(),
        uniqueVisitors: count < 3 ? 0 : count,
      }));
    const populated = items.filter((item) => item.uniqueVisitors > 0);
    const peak = populated.reduce<(typeof items)[number] | undefined>(
      (best, item) =>
        !best || item.uniqueVisitors > best.uniqueVisitors ? item : best,
      undefined,
    );
    const quiet = populated.reduce<(typeof items)[number] | undefined>(
      (best, item) =>
        !best || item.uniqueVisitors < best.uniqueVisitors ? item : best,
      undefined,
    );
    return {
      timezone: 'Asia/Ho_Chi_Minh',
      bucketMinutes: 15,
      items,
      ...(peak ? { peak } : {}),
      ...(quiet ? { quiet } : {}),
    };
  }

  async onModuleDestroy(): Promise<void> {
    await this.store.close();
  }

  private async ownedSession(
    userId: string,
    sessionId: string,
  ): Promise<LivePresence> {
    const session = await this.store.find(sessionId);
    if (!session) throw new NotFoundException('Presence session not found');
    if (session.userId !== userId)
      throw new ForbiddenException('Presence session forbidden');
    return session;
  }

  private toPoint(
    item: LivePresence,
    hasPaidTicket: boolean,
  ): AdminPresencePoint | undefined {
    if (
      item.latitude === undefined ||
      item.longitude === undefined ||
      item.accuracyMeters === undefined
    ) {
      return undefined;
    }
    return {
      sessionId: item.id,
      pseudonym: item.pseudonym,
      avatarVariant: item.avatarVariant,
      hasPaidTicket,
      latitude: item.latitude,
      longitude: item.longitude,
      accuracyMeters: item.accuracyMeters,
      ...(item.destinationPoiId
        ? { destinationPoiId: item.destinationPoiId }
        : {}),
      updatedAt: item.updatedAt,
    };
  }

  private toVisitorPoint(item: LivePresence): VisitorPresencePoint | undefined {
    if (
      !item.visibleToVisitors ||
      item.latitude === undefined ||
      item.longitude === undefined
    ) {
      return undefined;
    }
    const location =
      item.locationMode === 'shared'
        ? this.blurForVisitors(item.id, item.latitude, item.longitude)
        : { latitude: item.latitude, longitude: item.longitude };
    return {
      presenceId: item.id,
      pseudonym: item.pseudonym,
      avatarVariant: item.avatarVariant,
      ...location,
      locationMode: item.locationMode,
      updatedAt: item.updatedAt,
    };
  }

  private blurForVisitors(
    id: string,
    latitude: number,
    longitude: number,
  ): { latitude: number; longitude: number } {
    let seed = 2166136261;
    for (const character of id) {
      seed ^= character.charCodeAt(0);
      seed = Math.imul(seed, 16777619);
    }
    const angle = (((seed >>> 0) % 3600) / 3600) * Math.PI * 2;
    const radiusMeters = 15;
    const latitudeRadians = (latitude * Math.PI) / 180;
    return {
      latitude: latitude + (Math.sin(angle) * radiusMeters) / 111_320,
      longitude:
        longitude +
        (Math.cos(angle) * radiusMeters) /
          (111_320 * Math.cos(latitudeRadians)),
    };
  }

  private findPaidUsers(userIds: string[]): Promise<Set<string>> {
    return this.repository.findPaidUserIds(
      userIds,
      dashboardRanges(this.now()).today,
    );
  }

  private assertEnabled(): void {
    if (!this.demo.enabled) {
      throw new ServiceUnavailableException('Demo presence is disabled');
    }
  }
}
