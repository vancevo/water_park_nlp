import type { SqlClient } from './postgres-poi.repository.js';
import type {
  FieldCheckQuery,
  FieldCheckRecord,
  FieldCheckRepository,
} from './field-check.models.js';

interface Row {
  id: string;
  client_id: string;
  poi_id: string;
  target: FieldCheckRecord['target'];
  entrance_id: string | null;
  latitude: number | string;
  longitude: number | string;
  accuracy_m: number | string;
  sample_count: number | string;
  outcome: FieldCheckRecord['outcome'];
  path_ok: boolean | null;
  note: string | null;
  distance_from_current_m: number | string;
  created_by: string;
  created_at: Date | string;
  applied_at: Date | string | null;
  applied_by: string | null;
}

const COLUMNS = `id, client_id, poi_id, target, entrance_id,
  ST_Y(location::geometry) AS latitude, ST_X(location::geometry) AS longitude,
  accuracy_m, sample_count, outcome, path_ok, note, distance_from_current_m,
  created_by, created_at, applied_at, applied_by`;

function toRecord(row: Row): FieldCheckRecord {
  return {
    id: row.id,
    clientId: row.client_id,
    poiId: row.poi_id,
    target: row.target,
    ...(row.entrance_id ? { entranceId: row.entrance_id } : {}),
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    accuracyMeters: Number(row.accuracy_m),
    sampleCount: Number(row.sample_count),
    outcome: row.outcome,
    ...(row.path_ok === null ? {} : { pathOk: row.path_ok }),
    ...(row.note ? { note: row.note } : {}),
    distanceFromCurrentMeters: Number(row.distance_from_current_m),
    createdBy: row.created_by,
    createdAt: new Date(row.created_at),
    ...(row.applied_at ? { appliedAt: new Date(row.applied_at) } : {}),
    ...(row.applied_by ? { appliedBy: row.applied_by } : {}),
  };
}

export class PostgresFieldCheckRepository implements FieldCheckRepository {
  constructor(private readonly client: SqlClient) {}

  async create(
    record: FieldCheckRecord,
  ): Promise<{ record: FieldCheckRecord; created: boolean }> {
    const inserted = await this.client.query<{ id: string }>(
      `INSERT INTO poi_field_checks
         (id, client_id, poi_id, target, entrance_id, location, accuracy_m, sample_count,
          outcome, path_ok, note, distance_from_current_m, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography,
               $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT (client_id) DO NOTHING
       RETURNING id`,
      [
        record.id,
        record.clientId,
        record.poiId,
        record.target,
        record.entranceId ?? null,
        record.longitude,
        record.latitude,
        record.accuracyMeters,
        record.sampleCount,
        record.outcome,
        record.pathOk ?? null,
        record.note ?? null,
        record.distanceFromCurrentMeters,
        record.createdBy,
        record.createdAt.toISOString(),
      ],
    );
    const result = await this.client.query<Row>(
      `SELECT ${COLUMNS} FROM poi_field_checks WHERE client_id = $1`,
      [record.clientId],
    );
    return {
      record: toRecord(result.rows[0]!),
      created: inserted.rows.length > 0,
    };
  }

  async find(id: string): Promise<FieldCheckRecord | null> {
    const result = await this.client.query<Row>(
      `SELECT ${COLUMNS} FROM poi_field_checks WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  async list(query: FieldCheckQuery): Promise<FieldCheckRecord[]> {
    const values: unknown[] = [];
    const filters: string[] = [];
    if (query.poiId) {
      values.push(query.poiId);
      filters.push(`poi_id = $${values.length}`);
    }
    if (query.unappliedOnly) filters.push('applied_at IS NULL');
    values.push(query.limit);
    const result = await this.client.query<Row>(
      `SELECT ${COLUMNS} FROM poi_field_checks
       ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
       ORDER BY created_at DESC LIMIT $${values.length}`,
      values,
    );
    return result.rows.map(toRecord);
  }

  async markApplied(
    id: string,
    appliedBy: string,
    appliedAt: Date,
  ): Promise<void> {
    await this.client.query(
      'UPDATE poi_field_checks SET applied_by = $2, applied_at = $3 WHERE id = $1',
      [id, appliedBy, appliedAt.toISOString()],
    );
  }
}
