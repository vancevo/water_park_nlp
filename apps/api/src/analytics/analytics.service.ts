import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type {
  AnalyticsBatchResponse,
  AnalyticsEventInput,
  AnalyticsEventPayload,
  AnalyticsEventType,
  SupportedLocale,
} from '@damsen/shared-types';

import type { AnalyticsBatchDto } from './analytics.dto.js';
import {
  ANALYTICS_CLOCK,
  ANALYTICS_REPOSITORY,
  type AnalyticsEventRecord,
  type AnalyticsIdentity,
  type AnalyticsRepository,
} from './analytics.models.js';

const MAX_BATCH_BYTES = 32 * 1024;
const MAX_EVENT_BYTES = 4 * 1024;
const MAX_EVENT_AGE_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

const forbiddenKeys = new Set([
  'lat',
  'lng',
  'latitude',
  'longitude',
  'gps',
  'gpstrail',
  'coordinates',
  'location',
  'routegeometry',
  'polyline',
  'email',
  'fullname',
  'phone',
  'address',
  'password',
  'token',
  'advertisingid',
  'deviceid',
  'ipaddress',
]);

interface PayloadRule {
  allowed: readonly string[];
  required: readonly string[];
}

const payloadRules: Record<AnalyticsEventType, PayloadRule> = {
  app_opened: { allowed: ['locale'], required: [] },
  poi_viewed: { allowed: ['poiId'], required: ['poiId'] },
  narration_started: {
    allowed: ['poiId', 'locale'],
    required: ['poiId', 'locale'],
  },
  narration_completed: {
    allowed: ['poiId', 'locale'],
    required: ['poiId', 'locale'],
  },
  route_requested: {
    allowed: ['poiId', 'accessible'],
    required: ['poiId'],
  },
  route_started: { allowed: ['poiId'], required: ['poiId'] },
  route_completed: { allowed: ['poiId'], required: ['poiId'] },
};

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class AnalyticsService {
  constructor(
    @Inject(ANALYTICS_REPOSITORY)
    private readonly repository: AnalyticsRepository,
    @Inject(ANALYTICS_CLOCK) private readonly clock: () => Date,
  ) {}

  async ingest(
    input: AnalyticsBatchDto,
    identity: AnalyticsIdentity,
  ): Promise<AnalyticsBatchResponse> {
    const now = this.clock();
    if (input.consent.analytics !== true) {
      this.reject(
        'ANALYTICS_CONSENT_REQUIRED',
        'Analytics consent must be explicitly enabled',
      );
    }
    if (input.events.length < 1 || input.events.length > 50) {
      this.reject(
        'ANALYTICS_BATCH_SIZE_INVALID',
        'Batch must contain between 1 and 50 events',
      );
    }
    const resolvedIdentity = this.resolveIdentity(input, identity);
    this.assertBodySize(input);
    const uniqueEvents = input.events.filter(
      (event, index, events) =>
        events.findIndex((candidate) => candidate.eventId === event.eventId) ===
        index,
    );
    const records = uniqueEvents.map((event) =>
      this.toRecord(event, resolvedIdentity, input.consent.policyVersion, now),
    );
    const insertedIds = await this.repository.insertBatch(records);
    const seen = new Set<string>();
    const acceptedEventIds: string[] = [];
    const duplicateEventIds: string[] = [];
    for (const event of input.events) {
      if (!seen.has(event.eventId) && insertedIds.has(event.eventId)) {
        acceptedEventIds.push(event.eventId);
      } else {
        duplicateEventIds.push(event.eventId);
      }
      seen.add(event.eventId);
    }
    return {
      acceptedEventIds,
      duplicateEventIds,
    };
  }

  private resolveIdentity(
    input: AnalyticsBatchDto,
    identity: AnalyticsIdentity,
  ): AnalyticsIdentity {
    if (identity.userId) return { userId: identity.userId };
    if (!input.anonymousSessionId) {
      this.reject(
        'ANALYTICS_IDENTITY_REQUIRED',
        'anonymousSessionId is required without an access token',
      );
    }
    return { anonymousSessionId: input.anonymousSessionId };
  }

  private assertBodySize(input: AnalyticsBatchDto): void {
    const bytes = Buffer.byteLength(JSON.stringify(input), 'utf8');
    if (bytes > MAX_BATCH_BYTES) {
      this.reject('ANALYTICS_BATCH_TOO_LARGE', 'Batch exceeds 32 KiB');
    }
  }

  private toRecord(
    event: AnalyticsEventInput,
    identity: AnalyticsIdentity,
    consentPolicyVersion: string,
    now: Date,
  ): AnalyticsEventRecord {
    if (Buffer.byteLength(JSON.stringify(event), 'utf8') > MAX_EVENT_BYTES) {
      this.reject('ANALYTICS_EVENT_TOO_LARGE', 'Event exceeds 4 KiB');
    }
    this.assertNoForbiddenKeys(event.payload);
    this.assertPayload(event.eventType, event.payload);
    const occurredAt = new Date(event.occurredAt);
    if (
      occurredAt.getTime() < now.getTime() - MAX_EVENT_AGE_MS ||
      occurredAt.getTime() > now.getTime() + MAX_FUTURE_SKEW_MS
    ) {
      this.reject(
        'ANALYTICS_EVENT_TIME_INVALID',
        'occurredAt must be within the last 30 days and at most 5 minutes in the future',
      );
    }
    return {
      ...event,
      ...identity,
      occurredAt: occurredAt.toISOString(),
      receivedAt: now,
      retentionUntil: new Date(now.getTime() + RETENTION_MS),
      consentPolicyVersion,
    };
  }

  private assertNoForbiddenKeys(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    for (const [key, nested] of Object.entries(value)) {
      const normalized = key.toLowerCase().replace(/[_-]/g, '');
      if (forbiddenKeys.has(normalized)) {
        this.reject(
          'ANALYTICS_FORBIDDEN_DATA',
          `Analytics payload contains forbidden field: ${key}`,
        );
      }
      this.assertNoForbiddenKeys(nested);
    }
  }

  private assertPayload(
    eventType: AnalyticsEventType,
    payload: AnalyticsEventPayload,
  ): void {
    const rule = payloadRules[eventType];
    const keys = Object.keys(payload);
    if (keys.some((key) => !rule.allowed.includes(key))) {
      this.reject(
        'ANALYTICS_PAYLOAD_INVALID',
        `Payload fields are not allowed for ${eventType}`,
      );
    }
    if (
      rule.required.some(
        (key) => payload[key as keyof AnalyticsEventPayload] == null,
      )
    ) {
      this.reject(
        'ANALYTICS_PAYLOAD_INVALID',
        `Required payload fields are missing for ${eventType}`,
      );
    }
    if (payload.poiId !== undefined && !UUID_V4.test(payload.poiId)) {
      this.reject('ANALYTICS_PAYLOAD_INVALID', 'poiId must be a UUID v4');
    }
    if (
      payload.locale !== undefined &&
      !(['vi', 'en'] satisfies SupportedLocale[]).includes(payload.locale)
    ) {
      this.reject('ANALYTICS_PAYLOAD_INVALID', 'locale must be vi or en');
    }
    if (
      payload.accessible !== undefined &&
      typeof payload.accessible !== 'boolean'
    ) {
      this.reject('ANALYTICS_PAYLOAD_INVALID', 'accessible must be boolean');
    }
  }

  private reject(code: string, message: string): never {
    throw new BadRequestException({ code, message, details: null });
  }
}
