import type {
  AnalyticsEventInput,
  AnalyticsEventType,
} from '@damsen/shared-types';

export interface AnalyticsIdentity {
  userId?: string;
  anonymousSessionId?: string;
}

export interface AnalyticsEventRecord extends AnalyticsEventInput {
  userId?: string;
  anonymousSessionId?: string;
  receivedAt: Date;
  retentionUntil: Date;
  consentPolicyVersion: string;
}

export interface AnalyticsRepository {
  insertBatch(events: AnalyticsEventRecord[]): Promise<Set<string>>;
}

export const ANALYTICS_REPOSITORY = Symbol('ANALYTICS_REPOSITORY');
export const ANALYTICS_CLOCK = Symbol('ANALYTICS_CLOCK');

export const ANALYTICS_EVENT_TYPES: readonly AnalyticsEventType[] = [
  'app_opened',
  'poi_viewed',
  'narration_started',
  'narration_completed',
  'route_requested',
  'route_started',
  'route_completed',
];
