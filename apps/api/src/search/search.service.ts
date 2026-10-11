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
  type VectorHit,
} from './search.models.js';
import { normalizeSearchText } from './search-text.js';
import { fuseRankings } from './hybrid-ranking.js';
import {
  matchNeedIntent,
  parsePoiNumber,
  needMatchesPlace,
  needOrder,
  type NeedIntent,
} from './search-need-intent.js';
import {
  parseDirectionIntent,
  residualText,
  selectDirectionalBand,
  sortByDirection,
  type DirectionIntent,
} from './search-geo-intent.js';

/**
 * Upper bound on POIs considered for a direction intent or a vector
 * expansion. A park catalogue is far below this; it only bounds the work.
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

    // "POI 21", "chỉ đường đến POI 11.1": the map number is the place.
    const number = parsePoiNumber(query.q);
    if (number !== null) {
      const prefix = `p${number.padStart(2, '0')}-`;
      const universe = await this.repository.search({
        ...this.repositoryQuery(query, at, {
          limit: DIRECTION_CANDIDATE_LIMIT,
          offset: 0,
        }),
        matchAll: true,
      });
      const found = universe.filter((candidate) =>
        candidate.record.slug.startsWith(prefix),
      );
      if (found.length > 0) {
        return this.paginate(
          found.map((candidate) =>
            this.result(candidate, query, at, new Set()),
          ),
          found.length,
          query,
        );
      }
    }

    // "tôi muốn đi về", "đi tắm", "I am hungry": a need, answered from the curated table.
    const need = matchNeedIntent(query.q);
    if (need) {
      const answered = await this.byNeed(query, at, need);
      if (answered) return answered;
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
   * Need intent: the places that satisfy the need, nearest first when the need is about the
   * visitor's surroundings and a position is given, else in the table's order. Returns null
   * when the query names a place outright or no place satisfies the need.
   */
  private async byNeed(
    query: SearchQueryDto,
    at: ClockParts,
    need: NeedIntent,
  ): Promise<SearchResponse | null> {
    const plain = await this.repository.search(
      this.repositoryQuery(query, at, { limit: 1, offset: 0 }),
    );
    if (plain[0]?.exactName || plain[0]?.normalizedName) return null;
    const universe = await this.repository.search({
      ...this.repositoryQuery(query, at, {
        limit: DIRECTION_CANDIDATE_LIMIT,
        offset: 0,
      }),
      matchAll: true,
    });
    // "Cổng số 2 — Nhà hàng Thủy Tạ ở đâu?": without the filler it is a place's name.
    if (
      need.core &&
      universe.some((candidate) =>
        Object.values(candidate.record.translations).some(
          (translation) =>
            normalizeSearchText(translation?.name ?? '') === need.core,
        ),
      )
    ) {
      return null;
    }
    const picked = universe.filter((candidate) =>
      needMatchesPlace(need, candidate.record),
    );
    if (picked.length === 0) return null;
    // Left-over words either name a place of this need ("nhà hàng Hương Sen": that place comes
    // first), name another place (for needs about the surroundings it is the anchor: "WC gần Đu
    // quay đứng" = the toilets nearest to the Ferris wheel; otherwise the normal search answers),
    // or match nothing (just noise).
    const named = new Set<string>();
    let anchor: { latitude: number; longitude: number } | null = null;
    if (need.residual) {
      const matches = await this.repository.search({
        ...this.repositoryQuery(query, at, {
          limit: DIRECTION_CANDIDATE_LIMIT,
          offset: 0,
        }),
        query: need.residual,
      });
      if (matches.length > 0) {
        const inNeed = matches.filter((candidate) =>
          needMatchesPlace(need, candidate.record),
        );
        if (inNeed.length > 0) {
          inNeed.forEach((candidate) => named.add(candidate.record.id));
        } else if (need.nearest || need.near) {
          anchor = matches[0]!.record;
        } else {
          return null;
        }
      }
    }
    const reference =
      anchor ??
      (query.lat !== undefined && query.lng !== undefined
        ? { latitude: query.lat, longitude: query.lng }
        : null);
    const away = (candidate: SearchCandidate): number =>
      anchor || candidate.distanceMeters === undefined
        ? reference
          ? distanceMeters(
              reference.latitude,
              reference.longitude,
              candidate.record.latitude,
              candidate.record.longitude,
            )
          : 0
        : candidate.distanceMeters;
    const located = (need.nearest && reference !== null) || anchor !== null;
    const ordered = [...picked].sort(
      (left, right) =>
        Number(named.has(right.record.id)) -
          Number(named.has(left.record.id)) ||
        (located ? away(left) - away(right) : 0) ||
        needOrder(need, left.record.slug) -
          needOrder(need, right.record.slug) ||
        left.record.slug.localeCompare(right.record.slug),
    );
    const items = ordered
      .slice(query.offset, query.offset + query.limit)
      .map((candidate) => {
        const result = this.result(candidate, query, at, new Set());
        // The reason this place answers the need ("there is an ATM next to it").
        const note = need.note?.[query.locale];
        return note ? { ...result, shortDescription: note } : result;
      });
    return this.paginate(items, ordered.length, query);
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
   * Hybrid (ADR 0012 + amendment 2026-10-10): fuse the top lexical pool with
   * the semantic (vector) order, and — when `expand.enabled` — add up to
   * `expand.limit` POIs the lexical query missed whose cosine similarity is at
   * least `expand.minSimilarity` (e.g. "music performance" → a stage whose
   * text never says "music"). Added POIs still pass the category/radius/
   * open-now filters. Fails closed: no vector, a deep page, nothing found or
   * any error returns null so the caller uses lexical.
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
      const lexicalTotal = pool[0]?.total ?? pool.length;
      const poolIds = pool.map((candidate) => candidate.record.id);
      const byId = new Map(pool.map((c) => [c.record.id, c]));

      const poolHits: VectorHit[] =
        pool.length > 0
          ? await hybrid.vectorSource.search({
              vector,
              locale: query.locale,
              limit: poolSize,
              poiIds: poolIds,
            })
          : [];
      const added = await this.vectorExpansion(query, at, hybrid, vector, byId);
      if (pool.length === 0 && added.length === 0) return null;

      const vectorOrder = [...poolHits, ...added]
        .sort(
          (a, b) =>
            b.similarity - a.similarity || a.poiId.localeCompare(b.poiId),
        )
        .map((hit) => hit.poiId);
      const vectorRanked = new Set(vectorOrder);
      const fused = fuseRankings(poolIds, vectorOrder, hybrid.flags.weights);
      const ordered = fused
        .map((entry) => byId.get(entry.id))
        .filter((c): c is SearchCandidate => c !== undefined);

      const page = ordered.slice(query.offset, query.offset + query.limit);
      const items = page.map((candidate) =>
        this.result(candidate, query, at, vectorRanked),
      );
      return this.paginate(items, lexicalTotal + added.length, query);
    } catch {
      return null; // Fail closed to lexical search.
    }
  }

  /**
   * Semantic neighbours that the lexical pool missed, above the similarity
   * floor and allowed by the request filters. Adds their candidates to `byId`.
   */
  private async vectorExpansion(
    query: SearchQueryDto,
    at: ClockParts,
    hybrid: HybridSearchDeps,
    vector: readonly number[],
    byId: Map<string, SearchCandidate>,
  ): Promise<VectorHit[]> {
    const { expand, poolSize } = hybrid.flags;
    if (!expand?.enabled) return [];
    const neighbours = await hybrid.vectorSource.search({
      vector,
      locale: query.locale,
      limit: poolSize,
    });
    const fresh = neighbours.filter(
      (hit) => hit.similarity >= expand.minSimilarity && !byId.has(hit.poiId),
    );
    if (fresh.length === 0) return [];
    const allowed = new Map(
      (
        await this.repository.search({
          ...this.repositoryQuery(query, at, {
            limit: DIRECTION_CANDIDATE_LIMIT,
            offset: 0,
          }),
          matchAll: true,
        })
      ).map((c) => [c.record.id, c]),
    );
    const added: VectorHit[] = [];
    for (const hit of fresh) {
      const candidate = allowed.get(hit.poiId);
      if (!candidate) continue;
      byId.set(hit.poiId, candidate);
      added.push(hit);
      if (added.length >= expand.limit) break;
    }
    return added;
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
