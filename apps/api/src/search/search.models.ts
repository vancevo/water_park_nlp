import type { PoiRecord } from '../poi/poi.models.js';

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
