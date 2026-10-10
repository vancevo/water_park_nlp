import type { PoiRecord } from '../poi/poi.models.js';
import type { SearchFlags } from './search-flags.js';

export interface SearchRepositoryQuery {
  query: string;
  locale: 'vi' | 'en';
  category?: string;
  latitude?: number;
  longitude?: number;
  radiusMeters?: number;
  openAt?: { dayOfWeek: number; minutes: number };
  limit: number;
  offset: number;
  /**
   * Skip the text filter and return every published POI that passes the
   * other filters (category/radius/open now), still scored against `query`.
   * Used for direction intents, where position — not text — decides.
   */
  matchAll?: boolean;
}

export interface SearchCandidate {
  record: PoiRecord;
  exactName: boolean;
  normalizedName: boolean;
  textScore: number;
  distanceMeters?: number;
  total: number;
}

export interface SearchRepository {
  search(query: SearchRepositoryQuery): Promise<SearchCandidate[]>;
}

export const SEARCH_REPOSITORY = Symbol('SEARCH_REPOSITORY');
export const SEARCH_CLOCK = Symbol('SEARCH_CLOCK');

// --- Hybrid semantic ranking (AI07 / T43) ---

/** A semantic neighbour of the query, by POI id and cosine similarity (0..1). */
export interface VectorHit {
  poiId: string;
  similarity: number;
}

export interface VectorSearchQuery {
  vector: readonly number[];
  locale: 'vi' | 'en';
  limit: number;
  /** When set, restrict the vector search to these POI ids (re-rank a pool). */
  poiIds?: readonly string[];
}

/** Port over the semantic_embeddings store (pgvector in prod, stub in tests). */
export interface VectorCandidateSource {
  search(query: VectorSearchQuery): Promise<VectorHit[]>;
}

/**
 * Embeds a query string at request time with the SAME model/version used to
 * build the stored document embeddings. Returns null when embedding is
 * unavailable so search falls back to lexical.
 */
export interface QueryEmbedder {
  readonly model: string;
  readonly modelVersion: string;
  embed(text: string, locale: 'vi' | 'en'): Promise<readonly number[] | null>;
}

export interface HybridSearchDeps {
  flags: SearchFlags;
  embedder: QueryEmbedder;
  vectorSource: VectorCandidateSource;
}

export const SEARCH_HYBRID = Symbol('SEARCH_HYBRID');
