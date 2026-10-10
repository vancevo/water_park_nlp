import { describe, expect, it, vi } from 'vitest';

import type { FieldCheckRecord } from '../src/poi/field-check.models.js';
import { PostgresFieldCheckRepository } from '../src/poi/postgres-field-check.repository.js';
import type { SqlClient } from '../src/poi/postgres-poi.repository.js';

const record: FieldCheckRecord = {
  id: '11111111-1111-4111-8111-111111111111',
  clientId: '22222222-2222-4222-8222-222222222222',
  poiId: '33333333-3333-4333-8333-333333333333',
  target: 'poi',
  latitude: 10.7658,
  longitude: 106.638,
  accuracyMeters: 6,
  sampleCount: 12,
  outcome: 'confirmed',
  distanceFromCurrentMeters: 4.2,
  createdBy: '44444444-4444-4444-8444-444444444444',
  createdAt: new Date('2026-10-10T03:00:00.000Z'),
};

const row = (overrides: Record<string, unknown> = {}) => ({
  id: record.id,
  client_id: record.clientId,
  poi_id: record.poiId,
  target: 'poi',
  entrance_id: null,
  latitude: '10.7658',
  longitude: '106.638',
  accuracy_m: '6',
  sample_count: '12',
  outcome: 'confirmed',
  path_ok: null,
  note: null,
  distance_from_current_m: '4.2',
  created_by: record.createdBy,
  created_at: '2026-10-10T03:00:00.000Z',
  applied_at: null,
  applied_by: null,
  ...overrides,
});

describe('PostgresFieldCheckRepository', () => {
  it('inserts idempotently on client_id and reports whether it created the row', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: record.id }] })
      .mockResolvedValueOnce({ rows: [row()] });
    const repository = new PostgresFieldCheckRepository({ query } as SqlClient);
    const result = await repository.create(record);
    expect(result.created).toBe(true);
    expect(result.record.latitude).toBe(10.7658);
    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('ON CONFLICT (client_id) DO NOTHING');
    expect(sql).toContain('ST_MakePoint($6, $7)'); // lon, lat
    expect(values[5]).toBe(106.638);
    expect(values[6]).toBe(10.7658);

    const retry = new PostgresFieldCheckRepository({
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [row()] }),
    } as SqlClient);
    expect((await retry.create(record)).created).toBe(false);
  });

  it('filters unapplied checks per POI, newest first, with a limit', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [row({ path_ok: true })] });
    const repository = new PostgresFieldCheckRepository({ query } as SqlClient);
    const [first] = await repository.list({
      poiId: record.poiId,
      unappliedOnly: true,
      limit: 25,
    });
    expect(first?.pathOk).toBe(true);
    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('poi_id = $1');
    expect(sql).toContain('applied_at IS NULL');
    expect(sql).toContain('ORDER BY created_at DESC LIMIT $2');
    expect(values).toEqual([record.poiId, 25]);
  });

  it('maps applied rows and entrance targets', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        row({
          target: 'entrance',
          entrance_id: 'e1',
          applied_at: '2026-10-10T04:00:00.000Z',
          applied_by: 'r1',
          note: 'cổng bên',
        }),
      ],
    });
    const found = await new PostgresFieldCheckRepository({
      query,
    } as SqlClient).find(record.id);
    expect(found).toMatchObject({
      target: 'entrance',
      entranceId: 'e1',
      appliedBy: 'r1',
      note: 'cổng bên',
    });
    expect(found?.appliedAt?.toISOString()).toBe('2026-10-10T04:00:00.000Z');
  });
});
