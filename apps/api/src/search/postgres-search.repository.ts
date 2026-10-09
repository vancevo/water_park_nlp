import type { PoiRecord } from '../poi/poi.models.js';
import type { SqlClient } from '../poi/postgres-poi.repository.js';
import type {
  SearchCandidate,
  SearchRepository,
  SearchRepositoryQuery,
} from './search.models.js';
import { searchTerms } from './search-text.js';

interface SearchRow {
  id: string;
  slug: string;
  category: string;
  status: PoiRecord['status'];
  latitude: number | string;
  longitude: number | string;
  translations: PoiRecord['translations'] | string;
  entrances: PoiRecord['entrances'] | string;
  operating_hours: PoiRecord['operatingHours'] | string;
  exact_name: boolean;
  normalized_name: boolean;
  text_score: number | string;
  distance_meters: number | string | null;
  total_count: number | string;
}

function jsonValue<T>(value: T | string): T {
  return typeof value === 'string' ? (JSON.parse(value) as T) : value;
}

function rowToCandidate(row: SearchRow): SearchCandidate {
  return {
    record: {
      id: row.id,
      slug: row.slug,
      category: row.category,
      status: row.status,
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      translations: jsonValue(row.translations),
      entrances: jsonValue(row.entrances),
      operatingHours: jsonValue(row.operating_hours),
    },
    exactName: row.exact_name,
    normalizedName: row.normalized_name,
    textScore: Number(row.text_score),
    ...(row.distance_meters === null
      ? {}
      : { distanceMeters: Number(row.distance_meters) }),
    total: Number(row.total_count),
  };
}

const DOCUMENT_TSV = `to_tsvector('simple', search_normalize(t.name || ' ' || t.short_description || ' ' || t.long_description))`;

export class PostgresSearchRepository implements SearchRepository {
  constructor(private readonly client: SqlClient) {}

  async search(query: SearchRepositoryQuery): Promise<SearchCandidate[]> {
    const values: unknown[] = [query.query, query.locale];
    const bind = (value: unknown): string => {
      values.push(value);
      return `$${values.length}`;
    };
    const { terms, minMatch } = searchTerms(query.query);
    const termsParam = bind(terms);
    const termsLength = terms.length;
    const minMatchParam = bind(minMatch);
    const orQueryParam = bind(terms.join(' | '));
    // Matches when at least `minMatch` significant terms occur in the name,
    // descriptions or category slug (OR semantics, not every word required);
    // a close whole-name fuzzy match still counts so typos keep working.
    const termsMatched = `(
      SELECT count(*) FROM unnest(${termsParam}::text[]) AS term(word)
      WHERE ${DOCUMENT_TSV} @@ plainto_tsquery('simple', term.word)
         OR search_normalize(c.slug) = term.word
    )`;
    const filters = [
      `p.status = 'published'`,
      `(${termsMatched} >= ${minMatchParam}
        OR search_normalize(t.name) % search_normalize($1))`,
    ];
    if (query.category) filters.push(`c.slug = ${bind(query.category)}`);

    let distanceExpression = 'NULL::double precision';
    if (query.latitude !== undefined && query.longitude !== undefined) {
      const longitude = bind(query.longitude);
      const latitude = bind(query.latitude);
      distanceExpression = `ST_Distance(p.location, ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography)`;
      if (query.radiusMeters !== undefined) {
        filters.push(
          `ST_DWithin(p.location, ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography, ${bind(query.radiusMeters)})`,
        );
      }
    }
    if (query.openAt) {
      const day = bind(query.openAt.dayOfWeek);
      const time = bind(
        `${String(Math.floor(query.openAt.minutes / 60)).padStart(2, '0')}:${String(query.openAt.minutes % 60).padStart(2, '0')}`,
      );
      filters.push(`EXISTS (
        SELECT 1 FROM poi_operating_hours open_hours
        WHERE open_hours.poi_id = p.id AND open_hours.day_of_week = ${day}
          AND ${time}::time >= open_hours.opens_at
          AND ${time}::time < open_hours.closes_at
      )`);
    }
    const limit = bind(query.limit);
    const offset = bind(query.offset);
    const sql = `
      WITH candidates AS (
        SELECT p.id, p.slug, c.slug AS category, p.status,
          ST_Y(p.location::geometry) AS latitude,
          ST_X(p.location::geometry) AS longitude,
          lower(trim(t.name)) = lower(trim($1)) AS exact_name,
          search_normalize(t.name) = search_normalize($1) AS normalized_name,
          ${distanceExpression} AS distance_meters,
          t.locale AS resolved_locale,
          t.name, t.short_description, t.long_description,
          (CASE
             WHEN lower(trim(t.name)) = lower(trim($1)) THEN 4.0
             WHEN search_normalize(t.name) = search_normalize($1) THEN 3.0
             ELSE 0.0
           END
           + 1.5 * ts_rank_cd(${DOCUMENT_TSV}, to_tsquery('simple', ${orQueryParam}))
           + 0.75 * (${termsMatched})::double precision / ${termsLength}
           + similarity(search_normalize(t.name), search_normalize($1))) AS lexical_score
        FROM pois p
        JOIN poi_categories c ON c.id = p.category_id
        JOIN LATERAL (
          SELECT pt.name, pt.short_description, pt.long_description, pt.locale
          FROM poi_translations pt
          WHERE pt.poi_id = p.id AND pt.locale IN ($2, 'vi')
          ORDER BY CASE WHEN pt.locale = $2 THEN 0 ELSE 1 END
          LIMIT 1
        ) t ON true
        WHERE ${filters.join(' AND ')}
      ), ranked AS (
        SELECT candidates.*,
          lexical_score + COALESCE(0.2 / (1 + distance_meters / 250.0), 0) AS final_score
        FROM candidates
      )
      SELECT ranked.*,
        COUNT(*) OVER() AS total_count,
        jsonb_build_object(
          resolved_locale, jsonb_build_object(
            'locale', resolved_locale,
            'name', name,
            'shortDescription', short_description,
            'longDescription', long_description
          )
        ) AS translations,
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', e.id,
            'labelVi', e.label_vi,
            'labelEn', e.label_en,
            'location', jsonb_build_object(
              'latitude', ST_Y(e.location::geometry),
              'longitude', ST_X(e.location::geometry)
            ),
            'graphNodeRef', e.graph_node_ref,
            'isPrimary', e.is_primary,
            'accessibility', e.accessibility
          ) ORDER BY e.is_primary DESC, e.id)
          FROM poi_entrances e WHERE e.poi_id = ranked.id AND e.is_active
        ), '[]'::jsonb) AS entrances,
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'dayOfWeek', h.day_of_week,
            'opensAt', to_char(h.opens_at, 'HH24:MI'),
            'closesAt', to_char(h.closes_at, 'HH24:MI')
          ) ORDER BY h.day_of_week)
          FROM poi_operating_hours h WHERE h.poi_id = ranked.id
        ), '[]'::jsonb) AS operating_hours,
        final_score AS text_score
      FROM ranked
      ORDER BY final_score DESC, id ASC
      LIMIT ${limit} OFFSET ${offset}`;
    const result = await this.client.query<SearchRow>(sql, values);
    return result.rows.map(rowToCandidate);
  }
}
