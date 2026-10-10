import { describe, expect, it } from 'vitest';

import { POI_FIXTURES } from '../src/poi/poi.fixtures.js';
import { SearchService } from '../src/search/search.service.js';
import { InMemoryVectorCandidateSource } from '../src/search/in-memory-vector.source.js';
import { DEFAULT_FUSION_WEIGHTS } from '../src/search/hybrid-ranking.js';
import type {
  HybridSearchDeps,
  QueryEmbedder,
  SearchCandidate,
  SearchRepository,
  SearchRepositoryQuery,
  VectorCandidateSource,
} from '../src/search/search.models.js';

const REC0 = POI_FIXTURES[0]!;
const REC1 = POI_FIXTURES[1]!;
const CLOCK = () => new Date('2026-09-25T03:00:00.000Z');
const QUERY = { q: 'dam sen', locale: 'vi' as const, limit: 20, offset: 0 };

class FakeRepo implements SearchRepository {
  constructor(private readonly candidates: SearchCandidate[]) {}
  async search(query: SearchRepositoryQuery): Promise<SearchCandidate[]> {
    const sorted = [...this.candidates].sort(
      (a, b) =>
        b.textScore - a.textScore || a.record.id.localeCompare(b.record.id),
    );
    const total = sorted.length;
    return sorted
      .slice(query.offset, query.offset + query.limit)
      .map((c) => ({ ...c, total }));
  }
}

function repo(): FakeRepo {
  return new FakeRepo([
    {
      record: REC0,
      exactName: false,
      normalizedName: false,
      textScore: 0.9,
      total: 0,
    },
    {
      record: REC1,
      exactName: false,
      normalizedName: false,
      textScore: 0.8,
      total: 0,
    },
  ]);
}

const fakeEmbedder = (vector: readonly number[] | null): QueryEmbedder => ({
  model: 'm',
  modelVersion: 'v',
  embed: async () => vector,
});

function hybridDeps(
  overrides: Partial<HybridSearchDeps> = {},
): HybridSearchDeps {
  return {
    flags: {
      hybridEnabled: true,
      poolSize: 50,
      weights: DEFAULT_FUSION_WEIGHTS,
    },
    embedder: fakeEmbedder([0.1, 0.2]),
    vectorSource: new InMemoryVectorCandidateSource(new Map([[REC1.id, 0.95]])),
    ...overrides,
  };
}

describe('SearchService hybrid ranking', () => {
  it('ranks lexically when hybrid is disabled', async () => {
    const service = new SearchService(repo(), CLOCK);
    const result = await service.search(QUERY);
    expect(result.items[0]?.id).toBe(REC0.id);
    expect(result.items.every((i) => !i.reasons.includes('semantic'))).toBe(
      true,
    );
  });

  it('re-ranks by the vector signal and marks semantic hits', async () => {
    const service = new SearchService(repo(), CLOCK, hybridDeps());
    const result = await service.search(QUERY);
    // REC1 was lexically second but the vector ranks it top → promoted.
    expect(result.items[0]?.id).toBe(REC1.id);
    expect(result.items[0]?.reasons).toContain('semantic');
    expect(result.items[1]?.id).toBe(REC0.id);
    expect(result.items[1]?.reasons).not.toContain('semantic');
    expect(result.total).toBe(2);
  });

  it('falls back to lexical when the embedder returns null', async () => {
    const service = new SearchService(
      repo(),
      CLOCK,
      hybridDeps({ embedder: fakeEmbedder(null) }),
    );
    const result = await service.search(QUERY);
    expect(result.items[0]?.id).toBe(REC0.id);
    expect(result.items.every((i) => !i.reasons.includes('semantic'))).toBe(
      true,
    );
  });

  it('falls back to lexical when the vector source throws', async () => {
    const throwing: VectorCandidateSource = {
      search: async () => {
        throw new Error('pgvector down');
      },
    };
    const service = new SearchService(
      repo(),
      CLOCK,
      hybridDeps({ vectorSource: throwing }),
    );
    const result = await service.search(QUERY);
    expect(result.items[0]?.id).toBe(REC0.id);
    expect(result.items.every((i) => !i.reasons.includes('semantic'))).toBe(
      true,
    );
  });
});

describe('SearchService hybrid vector expansion (C06)', () => {
  const REC2 = POI_FIXTURES[2]!;
  const REC3 = POI_FIXTURES[3]!;
  const QUERY_EN = {
    q: 'music performance',
    locale: 'en' as const,
    limit: 20,
    offset: 0,
  };

  /** Lexical finds nothing for the query; matchAll returns the whole catalogue. */
  class EmptyLexicalRepo implements SearchRepository {
    queries: SearchRepositoryQuery[] = [];
    async search(query: SearchRepositoryQuery): Promise<SearchCandidate[]> {
      this.queries.push(query);
      if (!query.matchAll) return [];
      const all = POI_FIXTURES.filter(
        (r) => !query.category || r.category === query.category,
      ).map((record) => ({
        record,
        exactName: false,
        normalizedName: false,
        textScore: 0,
        total: 0,
      }));
      return all.map((c) => ({ ...c, total: all.length }));
    }
  }

  const expanding = (
    similarities: Array<[string, number]>,
    expand = { enabled: true, minSimilarity: 0.5, limit: 3 },
  ): HybridSearchDeps =>
    hybridDeps({
      flags: {
        hybridEnabled: true,
        poolSize: 50,
        weights: DEFAULT_FUSION_WEIGHTS,
        expand,
      },
      vectorSource: new InMemoryVectorCandidateSource(new Map(similarities)),
    });

  it('adds POIs the lexical query missed when they are similar enough', async () => {
    const service = new SearchService(
      new EmptyLexicalRepo(),
      CLOCK,
      expanding([
        [REC2.id, 0.71],
        [REC0.id, 0.42],
      ]),
    );
    const result = await service.search(QUERY_EN);
    expect(result.items.map((i) => i.id)).toEqual([REC2.id]);
    expect(result.items[0]?.reasons).toContain('semantic');
    expect(result.total).toBe(1);
  });

  it('adds nothing below the similarity floor (nonsense queries stay empty)', async () => {
    const service = new SearchService(
      new EmptyLexicalRepo(),
      CLOCK,
      expanding([
        [REC2.id, 0.44],
        [REC0.id, 0.41],
      ]),
    );
    const result = await service.search(QUERY_EN);
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('respects the request filters and the expansion limit', async () => {
    const repoWithFilters = new EmptyLexicalRepo();
    const service = new SearchService(
      repoWithFilters,
      CLOCK,
      expanding(
        [
          [REC2.id, 0.9],
          [REC3.id, 0.8],
          [REC0.id, 0.7],
        ],
        { enabled: true, minSimilarity: 0.5, limit: 1 },
      ),
    );
    const limited = await service.search(QUERY_EN);
    expect(limited.items.map((i) => i.id)).toEqual([REC2.id]);

    const filtered = await service.search({
      ...QUERY_EN,
      category: REC3.category,
    });
    expect(filtered.items.every((i) => i.category === REC3.category)).toBe(
      true,
    );
    expect(repoWithFilters.queries.some((q) => q.matchAll)).toBe(true);
  });

  it('keeps lexical hits first and appends semantic-only ones after them', async () => {
    const lexical = repo();
    const mixed: SearchRepository = {
      search: (q) =>
        q.matchAll ? new EmptyLexicalRepo().search(q) : lexical.search(q),
    };
    const service = new SearchService(
      mixed,
      CLOCK,
      expanding([
        [REC0.id, 0.6],
        [REC1.id, 0.55],
        [REC2.id, 0.8],
      ]),
    );
    const result = await service.search(QUERY);
    const ids = result.items.map((i) => i.id);
    expect(ids).toContain(REC2.id);
    expect(ids.indexOf(REC0.id)).toBeLessThan(ids.indexOf(REC2.id));
    expect(result.total).toBe(3);
  });

  it('can be switched off (SEARCH_HYBRID_EXPAND=false)', async () => {
    const service = new SearchService(
      new EmptyLexicalRepo(),
      CLOCK,
      expanding([[REC2.id, 0.9]], {
        enabled: false,
        minSimilarity: 0.5,
        limit: 3,
      }),
    );
    expect((await service.search(QUERY_EN)).items).toEqual([]);
  });
});
