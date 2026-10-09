import type {
  NarrationRecord,
  NarrationRepository,
} from './narration.models.js';
import type { SqlClient } from '../poi/postgres-poi.repository.js';

interface NarrationRow {
  id: string;
  poi_id: string;
  locale: NarrationRecord['locale'];
  revision: number | string;
  transcript: string;
  workflow_status: NarrationRecord['status'];
  audio_object_key: string | null;
  audio_mime_type: NonNullable<NarrationRecord['audio']>['mimeType'] | null;
  audio_size_bytes: number | string | null;
  audio_sha256: string | null;
  audio_duration_seconds: number | string | null;
  rights_owner: string | null;
  rights_source: string | null;
  usage_rights: string | null;
  audio_generated_by: NarrationRecord['audioGeneratedBy'];
  created_by: string | null;
  reviewed_by: string | null;
  rejection_reason: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

const SELECT = `SELECT id, poi_id, locale, revision, transcript, workflow_status,
  audio_object_key, audio_mime_type, audio_size_bytes, audio_sha256,
  audio_duration_seconds, rights_owner, rights_source, usage_rights,
  audio_generated_by, created_by, reviewed_by, rejection_reason, created_at, updated_at
  FROM poi_narrations`;

function toRecord(row: NarrationRow): NarrationRecord {
  const hasAudio = row.audio_object_key !== null;
  return {
    id: row.id,
    poiId: row.poi_id,
    locale: row.locale,
    revision: Number(row.revision),
    transcript: row.transcript,
    status: row.workflow_status,
    audio: hasAudio
      ? {
          objectKey: row.audio_object_key!,
          mimeType: row.audio_mime_type!,
          sizeBytes: Number(row.audio_size_bytes),
          sha256: row.audio_sha256!,
          durationSeconds: Number(row.audio_duration_seconds),
          rightsOwner: row.rights_owner!,
          rightsSource: row.rights_source!,
          usageRights: row.usage_rights!,
        }
      : null,
    audioGeneratedBy: hasAudio ? (row.audio_generated_by ?? null) : null,
    createdBy: row.created_by ?? undefined,
    reviewedBy: row.reviewed_by ?? undefined,
    rejectionReason: row.rejection_reason ?? undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export class PostgresNarrationRepository implements NarrationRepository {
  constructor(private readonly client: SqlClient) {}

  async findPublished(
    poiId: string,
    locale: NarrationRecord['locale'],
  ): Promise<NarrationRecord | null> {
    const result = await this.client.query<NarrationRow>(
      `${SELECT} WHERE poi_id = $1 AND locale = $2 AND workflow_status = 'published'`,
      [poiId, locale],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  async findByPoi(poiId: string): Promise<NarrationRecord[]> {
    const result = await this.client.query<NarrationRow>(
      `${SELECT} WHERE poi_id = $1 ORDER BY locale, revision DESC`,
      [poiId],
    );
    return result.rows.map(toRecord);
  }

  async findById(id: string): Promise<NarrationRecord | null> {
    const result = await this.client.query<NarrationRow>(
      `${SELECT} WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  async nextRevision(
    poiId: string,
    locale: NarrationRecord['locale'],
  ): Promise<number> {
    const result = await this.client.query<{ next: number | string }>(
      `SELECT COALESCE(MAX(revision), 0) + 1 AS next
       FROM poi_narrations WHERE poi_id = $1 AND locale = $2`,
      [poiId, locale],
    );
    return Number(result.rows[0]?.next ?? 1);
  }

  async save(record: NarrationRecord): Promise<void> {
    await this.client.query(
      `INSERT INTO poi_narrations (
        id, poi_id, locale, revision, transcript, workflow_status,
        audio_object_key, audio_mime_type, audio_size_bytes, audio_sha256,
        audio_duration_seconds, rights_owner, rights_source, usage_rights,
        created_by, reviewed_by, rejection_reason, created_at, updated_at,
        audio_generated_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb)
      ON CONFLICT (id) DO UPDATE SET transcript = EXCLUDED.transcript,
        workflow_status = EXCLUDED.workflow_status,
        audio_object_key = EXCLUDED.audio_object_key,
        audio_mime_type = EXCLUDED.audio_mime_type,
        audio_size_bytes = EXCLUDED.audio_size_bytes,
        audio_sha256 = EXCLUDED.audio_sha256,
        audio_duration_seconds = EXCLUDED.audio_duration_seconds,
        rights_owner = EXCLUDED.rights_owner, rights_source = EXCLUDED.rights_source,
        usage_rights = EXCLUDED.usage_rights,
        audio_generated_by = EXCLUDED.audio_generated_by,
        reviewed_by = EXCLUDED.reviewed_by,
        rejection_reason = EXCLUDED.rejection_reason, updated_at = EXCLUDED.updated_at`,
      [
        record.id,
        record.poiId,
        record.locale,
        record.revision,
        record.transcript,
        record.status,
        record.audio?.objectKey ?? null,
        record.audio?.mimeType ?? null,
        record.audio?.sizeBytes ?? null,
        record.audio?.sha256 ?? null,
        record.audio?.durationSeconds ?? null,
        record.audio?.rightsOwner ?? null,
        record.audio?.rightsSource ?? null,
        record.audio?.usageRights ?? null,
        record.createdBy ?? null,
        record.reviewedBy ?? null,
        record.rejectionReason ?? null,
        record.createdAt,
        record.updatedAt,
        record.audio && record.audioGeneratedBy
          ? JSON.stringify(record.audioGeneratedBy)
          : null,
      ],
    );
  }

  async delete(id: string): Promise<void> {
    await this.client.query('DELETE FROM poi_narrations WHERE id = $1', [id]);
  }

  async publish(
    id: string,
    reviewerId: string,
    reviewedAt: Date,
  ): Promise<void> {
    await this.client.query('SELECT publish_poi_narration($1, $2, $3)', [
      id,
      reviewerId,
      reviewedAt,
    ]);
  }
}
