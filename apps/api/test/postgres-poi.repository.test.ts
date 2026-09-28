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
});
