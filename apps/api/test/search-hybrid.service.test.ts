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
