import type {
  PoiAuditRecord,
  PoiContentVersionRecord,
  PoiRecord,
  PoiRepository,
  PoiRepositoryQuery,
} from './poi.models.js';

interface QueryResult<Row> {
  rows: Row[];
}

export interface SqlClient {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<Row>>;
}

interface PoiRow {
  id: string;
  slug: string;
  category: string;
  status: PoiRecord['status'];
  latitude: number | string;
  longitude: number | string;
  translations: PoiRecord['translations'] | string;
  entrances: PoiRecord['entrances'] | string;
  operating_hours: PoiRecord['operatingHours'] | string;
  pending_version_id?: string | null;
  rejection_reason?: string | null;
}

function jsonValue<T>(value: T | string): T {
  return typeof value === 'string' ? (JSON.parse(value) as T) : value;
}

function toRecord(row: PoiRow): PoiRecord {
  return {
    id: row.id,
    slug: row.slug,
    category: row.category,
    status: row.status,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    translations: jsonValue(row.translations),
    entrances: jsonValue(row.entrances),
    operatingHours: jsonValue(row.operating_hours),
    // The workflow pointers live on the version rows; without them a pending
    // POI could never be approved or rejected against Postgres.
    ...(row.status === 'pending_review' && row.pending_version_id
      ? { pendingVersionId: row.pending_version_id }
      : {}),
    ...(row.status === 'rejected' && row.rejection_reason
      ? { rejectionReason: row.rejection_reason }
      : {}),
  };
}

const SELECT_POI = `
  SELECT p.id, p.slug, c.slug AS category, p.status,
    ST_Y(p.location::geometry) AS latitude,
    ST_X(p.location::geometry) AS longitude,
    COALESCE((
      SELECT jsonb_object_agg(t.locale, jsonb_build_object(
        'locale', t.locale,
        'name', t.name,
        'shortDescription', t.short_description,
        'longDescription', t.long_description
      )) FROM poi_translations t WHERE t.poi_id = p.id
    ), '{}'::jsonb) AS translations,
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
      FROM poi_entrances e WHERE e.poi_id = p.id AND e.is_active
    ), '[]'::jsonb) AS entrances,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'dayOfWeek', h.day_of_week,
        'opensAt', to_char(h.opens_at, 'HH24:MI'),
        'closesAt', to_char(h.closes_at, 'HH24:MI')
      ) ORDER BY h.day_of_week)
      FROM poi_operating_hours h WHERE h.poi_id = p.id
    ), '[]'::jsonb) AS operating_hours,
    (SELECT v.id FROM poi_content_versions v
      WHERE v.poi_id = p.id AND v.workflow_status = 'pending_review'
      ORDER BY v.version DESC LIMIT 1) AS pending_version_id,
    (SELECT v.reason FROM poi_content_versions v
      WHERE v.poi_id = p.id AND v.workflow_status = 'rejected'
      ORDER BY v.version DESC LIMIT 1) AS rejection_reason
  FROM pois p
  JOIN poi_categories c ON c.id = p.category_id`;

export class PostgresPoiRepository implements PoiRepository {
  constructor(private readonly client: SqlClient) {}

  async findPublished(query: PoiRepositoryQuery): Promise<PoiRecord[]> {
    const values: unknown[] = [];
    const conditions = [`p.status = 'published'`];
    const bind = (value: unknown): string => {
      values.push(value);
      return `$${values.length}`;
    };

    if (query.category) {
      conditions.push(`c.slug = ${bind(query.category)}`);
    }
    if (
      query.latitude !== undefined &&
      query.longitude !== undefined &&
      query.radiusMeters !== undefined
    ) {
      const lng = bind(query.longitude);
      const lat = bind(query.latitude);
      const radius = bind(query.radiusMeters);
      conditions.push(
        `ST_DWithin(p.location, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography, ${radius})`,
      );
    }
    if (query.openAt) {
      const day = bind(query.openAt.dayOfWeek);
      const time = bind(
        `${String(Math.floor(query.openAt.minutes / 60)).padStart(2, '0')}:${String(query.openAt.minutes % 60).padStart(2, '0')}`,
      );
      conditions.push(`EXISTS (
        SELECT 1 FROM poi_operating_hours oh
        WHERE oh.poi_id = p.id AND oh.day_of_week = ${day}
          AND ${time}::time >= oh.opens_at AND ${time}::time < oh.closes_at
      )`);
    }

    const order =
      query.latitude !== undefined && query.longitude !== undefined
        ? `ST_Distance(p.location, ST_SetSRID(ST_MakePoint(${bind(query.longitude)}, ${bind(query.latitude)}), 4326)::geography), p.slug`
        : 'p.slug';
    const result = await this.client.query<PoiRow>(
      `${SELECT_POI} WHERE ${conditions.join(' AND ')} ORDER BY ${order}`,
      values,
    );
    return result.rows.map(toRecord);
  }

  async findPublishedById(id: string): Promise<PoiRecord | null> {
    const result = await this.client.query<PoiRow>(
      `${SELECT_POI} WHERE p.status = 'published' AND p.id = $1`,
      [id],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  async findAllForAdmin(): Promise<PoiRecord[]> {
    const result = await this.client.query<PoiRow>(
      `${SELECT_POI} ORDER BY p.slug`,
    );
    return result.rows.map(toRecord);
  }

  async findForAdmin(id: string): Promise<PoiRecord | null> {
    const result = await this.client.query<PoiRow>(
      `${SELECT_POI} WHERE p.id = $1`,
      [id],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  async save(record: PoiRecord): Promise<void> {
    await this.client.query(
      `INSERT INTO pois (id, slug, category_id, status, location, source)
       SELECT $1, $2, c.id, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, 'admin'
       FROM poi_categories c WHERE c.slug = $6
       ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, category_id = EXCLUDED.category_id,
         status = EXCLUDED.status, location = EXCLUDED.location, updated_at = now()`,
      [
        record.id,
        record.slug,
        record.status,
        record.longitude,
        record.latitude,
        record.category,
      ],
    );
    await this.client.query('DELETE FROM poi_translations WHERE poi_id = $1', [
      record.id,
    ]);
    for (const translation of Object.values(record.translations)) {
      if (!translation) continue;
      await this.client.query(
        `INSERT INTO poi_translations (poi_id, locale, name, short_description, long_description)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          record.id,
          translation.locale,
          translation.name,
          translation.shortDescription,
          translation.longDescription,
        ],
      );
    }
    await this.client.query('DELETE FROM poi_entrances WHERE poi_id = $1', [
      record.id,
    ]);
    for (const entrance of record.entrances) {
      await this.client.query(
        `INSERT INTO poi_entrances (id, poi_id, label_vi, label_en, location, graph_node_ref, is_primary, accessibility)
         VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography, $7, $8, $9)`,
        [
          entrance.id,
          record.id,
          entrance.labelVi,
          entrance.labelEn,
          entrance.location.longitude,
          entrance.location.latitude,
          entrance.graphNodeRef,
          entrance.isPrimary,
          entrance.accessibility,
        ],
      );
    }
    await this.client.query(
      'DELETE FROM poi_operating_hours WHERE poi_id = $1',
      [record.id],
    );
    for (const hours of record.operatingHours) {
      await this.client.query(
        `INSERT INTO poi_operating_hours (poi_id, day_of_week, opens_at, closes_at) VALUES ($1, $2, $3, $4)`,
        [record.id, hours.dayOfWeek, hours.opensAt, hours.closesAt],
      );
    }
  }

  async delete(id: string): Promise<void> {
    await this.client.query('DELETE FROM pois WHERE id = $1', [id]);
  }

  async saveVersion(version: PoiContentVersionRecord): Promise<void> {
    await this.client.query(
      `INSERT INTO poi_content_versions (id, poi_id, version, content_json, workflow_status, created_by, reviewer_id, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET workflow_status = EXCLUDED.workflow_status,
         reviewer_id = EXCLUDED.reviewer_id, reason = EXCLUDED.reason, reviewed_at = now()`,
      [
        version.id,
        version.poiId,
        version.version,
        JSON.stringify(version.snapshot),
        version.status,
        version.createdBy,
        version.reviewedBy ?? null,
        version.reason ?? null,
      ],
    );
  }

  async findVersion(id: string): Promise<PoiContentVersionRecord | null> {
    const result = await this.client.query<{
      id: string;
      poi_id: string;
      version: number;
      content_json: PoiRecord | string;
      workflow_status: PoiRecord['status'];
      created_by: string;
      reviewer_id: string | null;
      reason: string | null;
    }>(
      `SELECT id, poi_id, version, content_json, workflow_status, created_by, reviewer_id, reason FROM poi_content_versions WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          poiId: row.poi_id,
          version: row.version,
          snapshot: jsonValue(row.content_json),
          status: row.workflow_status,
          createdBy: row.created_by,
          reviewedBy: row.reviewer_id ?? undefined,
          reason: row.reason ?? undefined,
        }
      : null;
  }

  async nextVersion(poiId: string): Promise<number> {
    const result = await this.client.query<{ next: number | string }>(
      'SELECT COALESCE(MAX(version), 0) + 1 AS next FROM poi_content_versions WHERE poi_id = $1',
      [poiId],
    );
    return Number(result.rows[0]?.next ?? 1);
  }

  async saveAudit(record: PoiAuditRecord): Promise<void> {
    await this.client.query(
      `INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, before_json, after_json, created_at)
       VALUES ($1, $2, $3, 'poi', $4, $5, $6, $7)`,
      [
        record.id,
        record.actorId,
        record.action,
        record.entityId,
        record.before ? JSON.stringify(record.before) : null,
        record.after ? JSON.stringify(record.after) : null,
        record.createdAt,
      ],
    );
  }

  async findAudit(): Promise<PoiAuditRecord[]> {
    const result = await this.client.query<{
      id: string;
      actor_id: string;
      action: string;
      entity_id: string;
      before_json: PoiRecord | string | null;
      after_json: PoiRecord | string | null;
      created_at: Date | string;
    }>(
      `SELECT id, actor_id, action, entity_id, before_json, after_json, created_at FROM audit_logs WHERE entity_type = 'poi' ORDER BY created_at DESC`,
    );
    return result.rows.map((row) => ({
      id: row.id,
      actorId: row.actor_id,
      action: row.action,
      entityId: row.entity_id,
      before: row.before_json ? jsonValue(row.before_json) : null,
      after: row.after_json ? jsonValue(row.after_json) : null,
      createdAt: new Date(row.created_at),
    }));
  }
}
