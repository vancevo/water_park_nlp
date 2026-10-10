import {
  BadRequestException,
  Inject,
  Injectable,
  Optional,
} from '@nestjs/common';
import type {
  SearchReason,
  SearchResponse,
  SearchResult,
  SupportedLocale,
} from '@damsen/shared-types';

import { distanceMeters } from '../poi/in-memory-poi.repository.js';
import type { PoiRecord } from '../poi/poi.models.js';
import type { SearchQueryDto } from './search.dto.js';
import {
  SEARCH_CLOCK,
  SEARCH_HYBRID,
  SEARCH_REPOSITORY,
  type HybridSearchDeps,
  type SearchCandidate,
  type SearchRepository,
  type SearchRepositoryQuery,
} from './search.models.js';
import { normalizeSearchText } from './search-text.js';
import { fuseRankings } from './hybrid-ranking.js';
import {
  parseDirectionIntent,
  residualText,
  selectDirectionalBand,
  sortByDirection,
  type DirectionIntent,
} from './search-geo-intent.js';

/**
 * Upper bound on POIs considered for a direction intent. A park catalogue is
 * far below this; it only bounds the in-memory ordering.
 */
const DIRECTION_CANDIDATE_LIMIT = 500;

const VIETNAM_UTC_OFFSET_MS = 7 * 60 * 60 * 1000;

type ClockParts = { dayOfWeek: number; minutes: number };

function vietnamTime(date: Date): ClockParts {
  const local = new Date(date.getTime() + VIETNAM_UTC_OFFSET_MS);
  return {
    dayOfWeek: local.getUTCDay(),
    minutes: local.getUTCHours() * 60 + local.getUTCMinutes(),
  };
}

function recordIsOpen(record: PoiRecord, at: ClockParts): boolean {
  return record.operatingHours.some((hours) => {
    if (hours.dayOfWeek !== at.dayOfWeek) return false;
    const [openHour = 0, openMinute = 0] = hours.opensAt.split(':').map(Number);
    const [closeHour = 0, closeMinute = 0] = hours.closesAt
      .split(':')
      .map(Number);
    return (
      at.minutes >= openHour * 60 + openMinute &&
      at.minutes < closeHour * 60 + closeMinute
    );
  });
}

@Injectable()
export class SearchService {
  constructor(
    @Inject(SEARCH_REPOSITORY) private readonly repository: SearchRepository,
    @Inject(SEARCH_CLOCK) private readonly now: () => Date,
    @Optional()
    @Inject(SEARCH_HYBRID)
    private readonly hybrid: HybridSearchDeps | null = null,
  ) {}

  async search(query: SearchQueryDto): Promise<SearchResponse> {
    this.validateQuery(query);
    const at = vietnamTime(this.now());

    // "westernmost …", "xa nhất về phía đông": position decides, not text.
    const intent = parseDirectionIntent(query.q);
    if (intent) {
      const directional = await this.directional(query, at, intent);
      if (directional) return directional;
    }

    if (this.hybrid?.flags.hybridEnabled) {
      const fused = await this.tryHybrid(query, at, this.hybrid);
      if (fused) return fused;
    }
    return this.lexical(query, at);
  }

  /** Lexical baseline: the repository paginates and scores. */
  private async lexical(
    query: SearchQueryDto,
    at: ClockParts,
  ): Promise<SearchResponse> {
    const candidates = await this.repository.search(
      this.repositoryQuery(query, at, {
        limit: query.limit,
        offset: query.offset,
      }),
    );
    const total = candidates[0]?.total ?? 0;
    const items = candidates.map((candidate) =>
      this.result(candidate, query, at, new Set()),
    );
    return this.paginate(items, total, query);
  }

  /**
   * Direction intent (C06). Candidate set, farthest-first along the axis:
   * 1. the POIs matching the residual text that lie at that edge, else
   * 2. the POIs matching the residual text, ordered toward that edge, else
   * 3. (no residual text, or nothing matched it) the POIs at that edge.
   * Returns null when the query names a POI outright ("West Gate"), so a
   * name that happens to contain a direction keeps the lexical answer.
   */
  private async directional(
    query: SearchQueryDto,
    at: ClockParts,
    intent: DirectionIntent,
  ): Promise<SearchResponse | null> {
    const page = { limit: DIRECTION_CANDIDATE_LIMIT, offset: 0 };
    const plain = await this.repository.search(
      this.repositoryQuery(query, at, { limit: 1, offset: 0 }),
    );
    if (plain[0]?.exactName || plain[0]?.normalizedName) return null;

    const position = (candidate: SearchCandidate) => candidate.record;
    let ordered: SearchCandidate[] = [];
    const text = residualText(intent.residual);
    if (text) {
      const matched = await this.repository.search({
        ...this.repositoryQuery(query, at, page),
        query: text,
      });
      if (matched.length > 0) {
        const universe = await this.repository.search({
          ...this.repositoryQuery(query, at, page),
          matchAll: true,
        });
        const edge = new Set(
          selectDirectionalBand(universe, intent.direction, position).map(
            (candidate) => candidate.record.id,
          ),
        );
        const atEdge = matched.filter((c) => edge.has(c.record.id));
        ordered = sortByDirection(
          atEdge.length > 0 ? atEdge : matched,
          intent.direction,
          position,
        );
      }
    }
    if (ordered.length === 0) {
      const universe = await this.repository.search({
        ...this.repositoryQuery(query, at, page),
        matchAll: true,
      });
      ordered = selectDirectionalBand(universe, intent.direction, position);
    }
    const items = ordered
      .slice(query.offset, query.offset + query.limit)
      .map((candidate) => this.result(candidate, query, at, new Set()));
    return this.paginate(items, ordered.length, query);
  }

  /**
   * Hybrid: re-rank the top lexical pool by fusing lexical order with the
   * semantic (vector) order, then paginate. Fails closed — any missing vector,
   * empty pool, deep page or error returns null so the caller uses lexical.
   * The candidate SET is unchanged (re-ranking only), so total/pagination stay
   * consistent with the lexical baseline.
   */
  private async tryHybrid(
    query: SearchQueryDto,
    at: ClockParts,
    hybrid: HybridSearchDeps,
  ): Promise<SearchResponse | null> {
    const poolSize = hybrid.flags.poolSize;
    // Deep pages fall back to lexical ordering beyond the re-ranked pool.
    if (query.offset >= poolSize) return null;
    try {
      const vector = await hybrid.embedder.embed(query.q.trim(), query.locale);
      if (!vector || vector.length === 0) return null;

      const pool = await this.repository.search(
        this.repositoryQuery(query, at, { limit: poolSize, offset: 0 }),
      );
      if (pool.length === 0) return null;
      const total = pool[0]?.total ?? pool.length;
      const poolIds = pool.map((candidate) => candidate.record.id);

      const vectorHits = await hybrid.vectorSource.search({
        vector,
        locale: query.locale,
        limit: poolSize,
        poiIds: poolIds,
      });
      const vectorRanked = new Set(vectorHits.map((hit) => hit.poiId));

      const fused = fuseRankings(
        poolIds,
        vectorHits.map((hit) => hit.poiId),
        hybrid.flags.weights,
      );
      const byId = new Map(pool.map((c) => [c.record.id, c]));
      const ordered = fused
        .map((entry) => byId.get(entry.id))
        .filter((c): c is SearchCandidate => c !== undefined);

      const page = ordered.slice(query.offset, query.offset + query.limit);
      const items = page.map((candidate) =>
        this.result(candidate, query, at, vectorRanked),
      );
      return this.paginate(items, total, query);
    } catch {
      return null; // Fail closed to lexical search.
    }
  }

  private repositoryQuery(
    query: SearchQueryDto,
    at: ClockParts,
    page: { limit: number; offset: number },
  ): SearchRepositoryQuery {
    return {
      query: query.q.trim(),
      locale: query.locale,
      category: query.category,
      latitude: query.lat,
      longitude: query.lng,
      radiusMeters: query.radius,
      openAt: query.openNow ? at : undefined,
      limit: page.limit,
      offset: page.offset,
    };
  }

  private paginate(
    items: SearchResult[],
    total: number,
    query: SearchQueryDto,
  ): SearchResponse {
    const nextOffset = query.offset + items.length;
    return {
      items,
      total,
      limit: query.limit,
      offset: query.offset,
      ...(nextOffset < total ? { nextOffset } : {}),
    };
  }

  private validateQuery(query: SearchQueryDto): void {
    const hasLat = query.lat !== undefined;
    const hasLng = query.lng !== undefined;
    if (hasLat !== hasLng) {
      throw new BadRequestException('lat and lng must be provided together');
    }
    if (query.radius !== undefined && !hasLat) {
      throw new BadRequestException('radius requires lat and lng');
    }
    if (!normalizeSearchText(query.q)) {
      throw new BadRequestException('q must contain letters or numbers');
    }
  }

  private result(
    candidate: SearchCandidate,
    query: SearchQueryDto,
    at: ClockParts,
    vectorRanked: ReadonlySet<string>,
  ): SearchResult {
    const requestedLocale: SupportedLocale = query.locale;
    const translation =
      candidate.record.translations[requestedLocale] ??
      candidate.record.translations.vi;
    if (!translation) {
      throw new BadRequestException('Search result translation is unavailable');
    }
    const isOpen = recordIsOpen(candidate.record, at);
    const distance =
      candidate.distanceMeters ??
      (query.lat !== undefined && query.lng !== undefined
        ? distanceMeters(
            query.lat,
            query.lng,
            candidate.record.latitude,
            candidate.record.longitude,
          )
        : undefined);
    const reasons: SearchReason[] = [
      candidate.exactName
        ? 'exact_name'
        : candidate.normalizedName
          ? 'accent_insensitive_name'
          : 'text_match',
      ...(distance !== undefined ? (['nearby'] as const) : []),
      ...(isOpen ? (['open_now'] as const) : []),
      ...(vectorRanked.has(candidate.record.id) ? (['semantic'] as const) : []),
    ];
    return {
      id: candidate.record.id,
      slug: candidate.record.slug,
      category: candidate.record.category,
      location: {
        latitude: candidate.record.latitude,
        longitude: candidate.record.longitude,
      },
      requestedLocale,
      resolvedLocale: translation.locale,
      fallbackUsed: translation.locale !== requestedLocale,
      name: translation.name,
      shortDescription: translation.shortDescription,
      isOpen,
      ...(distance === undefined
        ? {}
        : { distanceMeters: Math.round(distance) }),
      score: Number(candidate.textScore.toFixed(6)),
      reasons,
    };
  }
}
