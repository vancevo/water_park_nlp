import { createClient } from 'redis';
import type { VisitorPresenceMode } from '@damsen/shared-types';

export const PRESENCE_STORE = Symbol('PRESENCE_STORE');
export const PRESENCE_TTL_SECONDS = 45;
const HISTORY_TTL_SECONDS = 31 * 24 * 60 * 60;
const PRIMARY_OPERATION_TIMEOUT_MS = 200;

export interface LivePresence {
  id: string;
  userId: string;
  pseudonym: string;
  avatarVariant: number;
  shareIdentity: boolean;
  visibleToVisitors: boolean;
  locationMode: VisitorPresenceMode;
  lastSequence: number;
  lastLocationAt?: string;
  latitude?: number;
  longitude?: number;
  accuracyMeters?: number;
  destinationPoiId?: string;
  updatedAt: string;
}

export interface PresenceStore {
  save(session: LivePresence): Promise<void>;
  find(id: string): Promise<LivePresence | null>;
  remove(id: string): Promise<void>;
  list(): Promise<LivePresence[]>;
  recordTraffic(bucket: number, sessionId: string): Promise<void>;
  traffic(cutoff: number): Promise<Array<{ startsAt: number; count: number }>>;
  close(): Promise<void>;
}

export class MemoryPresenceStore implements PresenceStore {
  private readonly sessions = new Map<string, LivePresence>();
  private readonly visitors = new Map<number, Set<string>>();

  async save(session: LivePresence): Promise<void> {
    this.prune();
    this.sessions.set(session.id, structuredClone(session));
  }

  async find(id: string): Promise<LivePresence | null> {
    this.prune();
    const session = this.sessions.get(id);
    return session ? structuredClone(session) : null;
  }

  async remove(id: string): Promise<void> {
    this.sessions.delete(id);
  }

  async list(): Promise<LivePresence[]> {
    this.prune();
    return [...this.sessions.values()].map((item) => structuredClone(item));
  }

  async recordTraffic(bucket: number, sessionId: string): Promise<void> {
    const sessions = this.visitors.get(bucket) ?? new Set<string>();
    sessions.add(sessionId);
    this.visitors.set(bucket, sessions);
  }

  async traffic(cutoff: number) {
    for (const bucket of this.visitors.keys()) {
      if (bucket < cutoff) this.visitors.delete(bucket);
    }
    return [...this.visitors.entries()].map(([startsAt, visitors]) => ({
      startsAt,
      count: visitors.size,
    }));
  }

  async close(): Promise<void> {}

  private prune(): void {
    const cutoff = Date.now() - PRESENCE_TTL_SECONDS * 1_000;
    for (const [id, session] of this.sessions) {
      if (new Date(session.updatedAt).getTime() < cutoff)
        this.sessions.delete(id);
    }
  }
}

export class RedisPresenceStore implements PresenceStore {
  private client: ReturnType<typeof createClient>;
  private connectPromise?: Promise<void>;
  private retryAfter = 0;
  private readonly keyPrefix = 'damsen:demo:presence';

  constructor(private readonly redisUrl: string) {
    this.client = this.createRedisClient(redisUrl);
  }

  private createRedisClient(redisUrl: string) {
    const client = createClient({
      url: redisUrl,
      disableOfflineQueue: true,
      socket: {
        connectTimeout: 1_000,
        reconnectStrategy: false,
      },
    });
    client.on('error', () => undefined);
    return client;
  }

  async connect(): Promise<void> {
    await this.connectClient(1_500);
  }

  private async connectClient(timeoutMs: number): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.client.connect(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('REDIS_CONNECT_TIMEOUT')),
            timeoutMs,
          );
        }),
      ]);
    } catch (error) {
      if (this.client.isOpen) this.client.destroy();
      this.retryAfter = Date.now() + 1_000;
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async ensureReady(): Promise<void> {
    if (this.client.isReady) return;
    if (Date.now() < this.retryAfter)
      throw new Error('REDIS_RECONNECT_BACKOFF');
    if (!this.connectPromise) {
      if (this.client.isOpen) this.client.destroy();
      this.client = this.createRedisClient(this.redisUrl);
      this.connectPromise = this.connectClient(
        PRIMARY_OPERATION_TIMEOUT_MS,
      ).finally(() => {
        this.connectPromise = undefined;
      });
    }
    await this.connectPromise;
  }

  async save(session: LivePresence): Promise<void> {
    await this.ensureReady();
    const expiresAt = Date.now() + PRESENCE_TTL_SECONDS * 1_000;
    await this.client
      .multi()
      .set(this.sessionKey(session.id), JSON.stringify(session), {
        EX: PRESENCE_TTL_SECONDS,
      })
      .zAdd(this.indexKey(), { score: expiresAt, value: session.id })
      .zRemRangeByScore(this.indexKey(), 0, Date.now())
      .exec();
  }

  async find(id: string): Promise<LivePresence | null> {
    await this.ensureReady();
    return this.parse(await this.client.get(this.sessionKey(id)));
  }

  async remove(id: string): Promise<void> {
    await this.ensureReady();
    await this.client
      .multi()
      .del(this.sessionKey(id))
      .zRem(this.indexKey(), id)
      .exec();
  }

  async list(): Promise<LivePresence[]> {
    await this.ensureReady();
    await this.client.zRemRangeByScore(this.indexKey(), 0, Date.now());
    const ids = await this.client.zRangeByScore(
      this.indexKey(),
      Date.now(),
      Number.POSITIVE_INFINITY,
    );
    if (ids.length === 0) return [];
    const values = await this.client.mGet(ids.map((id) => this.sessionKey(id)));
    return values.flatMap((value) => {
      const parsed = this.parse(value);
      return parsed ? [parsed] : [];
    });
  }

  async recordTraffic(bucket: number, sessionId: string): Promise<void> {
    await this.ensureReady();
    const key = `${this.keyPrefix}:traffic:${bucket}`;
    await this.client
      .multi()
      .sAdd(key, sessionId)
      .expire(key, HISTORY_TTL_SECONDS)
      .zAdd(this.trafficIndexKey(), { score: bucket, value: String(bucket) })
      .expire(this.trafficIndexKey(), HISTORY_TTL_SECONDS)
      .exec();
  }

  async traffic(cutoff: number) {
    await this.ensureReady();
    await this.client.zRemRangeByScore(this.trafficIndexKey(), 0, cutoff - 1);
    const buckets = await this.client.zRangeByScore(
      this.trafficIndexKey(),
      cutoff,
      Number.POSITIVE_INFINITY,
    );
    return Promise.all(
      buckets.map(async (value) => ({
        startsAt: Number(value),
        count: await this.client.sCard(`${this.keyPrefix}:traffic:${value}`),
      })),
    );
  }

  async close(): Promise<void> {
    if (this.client.isReady) await this.client.quit();
    else if (this.client.isOpen) this.client.destroy();
  }

  private parse(value: string | null): LivePresence | null {
    if (!value) return null;
    try {
      return JSON.parse(value) as LivePresence;
    } catch {
      return null;
    }
  }

  private sessionKey(id: string): string {
    return `${this.keyPrefix}:${id}`;
  }

  private indexKey(): string {
    return `${this.keyPrefix}:index`;
  }

  private trafficIndexKey(): string {
    return `${this.keyPrefix}:traffic-index`;
  }
}

export class ResilientPresenceStore implements PresenceStore {
  constructor(
    private readonly primary: PresenceStore,
    private readonly fallback: PresenceStore,
  ) {}

  async save(session: LivePresence): Promise<void> {
    await this.fallback.save(session);
    await this.ignoreFailure(() => this.primary.save(session));
  }

  async find(id: string): Promise<LivePresence | null> {
    return (
      (await this.ignoreFailure(() => this.primary.find(id))) ??
      this.fallback.find(id)
    );
  }

  async remove(id: string): Promise<void> {
    await this.fallback.remove(id);
    await this.ignoreFailure(() => this.primary.remove(id));
  }

  async list(): Promise<LivePresence[]> {
    return (
      (await this.ignoreFailure(() => this.primary.list())) ??
      this.fallback.list()
    );
  }

  async recordTraffic(bucket: number, sessionId: string): Promise<void> {
    await this.fallback.recordTraffic(bucket, sessionId);
    await this.ignoreFailure(() =>
      this.primary.recordTraffic(bucket, sessionId),
    );
  }

  async traffic(cutoff: number) {
    return (
      (await this.ignoreFailure(() => this.primary.traffic(cutoff))) ??
      this.fallback.traffic(cutoff)
    );
  }

  async close(): Promise<void> {
    await Promise.allSettled([this.primary.close(), this.fallback.close()]);
  }

  private async ignoreFailure<T>(
    operation: () => Promise<T>,
  ): Promise<T | undefined> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        operation(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('PRESENCE_PRIMARY_TIMEOUT')),
            PRIMARY_OPERATION_TIMEOUT_MS,
          );
        }),
      ]);
    } catch {
      return undefined;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
