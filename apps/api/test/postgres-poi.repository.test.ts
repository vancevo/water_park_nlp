import { describe, expect, it, vi } from 'vitest';

import {
  PostgresPoiRepository,
  type SqlClient,
} from '../src/poi/postgres-poi.repository.js';

describe('PostgresPoiRepository', () => {
  it('builds a parameterized published PostGIS radius query', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repository = new PostgresPoiRepository({ query } as SqlClient);

    await repository.findPublished({
      latitude: 10.767,
      longitude: 106.635,
      radiusMeters: 250,
      category: 'garden',
      openAt: { dayOfWeek: 4, minutes: 600 },
    });

    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("p.status = 'published'");
    expect(sql).toContain('ST_DWithin');
    expect(sql).toContain('ST_Distance');
    expect(sql).toContain('poi_operating_hours');
    expect(values).toEqual([
      'garden',
      106.635,
      10.767,
      250,
      4,
      '10:00',
      106.635,
      10.767,
    ]);
  });

  it('keeps the published predicate on detail lookup', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repository = new PostgresPoiRepository({ query } as SqlClient);
    const id = '00000000-0000-4000-8000-000000000101';

    await expect(repository.findPublishedById(id)).resolves.toBeNull();
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("p.status = 'published' AND p.id = $1"),
      [id],
    );
  });

  describe('review workflow pointers (pending version / rejection reason)', () => {
    const row = (overrides: Record<string, unknown>) => ({
      id: 'p1',
      slug: 'x',
      category: 'show',
      status: 'draft',
      latitude: 10.7,
      longitude: 106.6,
      translations: {},
      entrances: [],
      operating_hours: [],
      pending_version_id: null,
      rejection_reason: null,
      ...overrides,
    });
    const load = async (overrides: Record<string, unknown>) => {
      const query = vi.fn().mockResolvedValue({ rows: [row(overrides)] });
      const repository = new PostgresPoiRepository({ query } as SqlClient);
      return { record: await repository.findForAdmin('p1'), query };
    };

    it('selects them from the version rows', async () => {
      const { query } = await load({});
      const [sql] = query.mock.calls[0] as [string];
      expect(sql).toContain("v.workflow_status = 'pending_review'");
      expect(sql).toContain("v.workflow_status = 'rejected'");
    });

    it('exposes the pending version id so approve/reject can find it', async () => {
      const { record } = await load({
        status: 'pending_review',
        pending_version_id: 'v-1',
      });
      expect(record?.pendingVersionId).toBe('v-1');
    });

    it('exposes the rejection reason only for rejected POIs', async () => {
      const rejected = await load({
        status: 'rejected',
        rejection_reason: 'no',
      });
      expect(rejected.record?.rejectionReason).toBe('no');
      const published = await load({
        status: 'published',
        pending_version_id: 'stale',
        rejection_reason: 'old',
      });
      expect(published.record?.pendingVersionId).toBeUndefined();
      expect(published.record?.rejectionReason).toBeUndefined();
    });
  });
});
