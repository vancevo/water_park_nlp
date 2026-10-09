import { describe, expect, it, vi } from 'vitest';

import { PostgresSearchRepository } from '../src/search/postgres-search.repository.js';
import type { SqlClient } from '../src/poi/postgres-poi.repository.js';

describe('PostgresSearchRepository', () => {
  it('builds indexed lexical/spatial filters and stable pagination', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repository = new PostgresSearchRepository({ query } as SqlClient);

    await repository.search({
      query: 'vuon cau vong',
      locale: 'vi',
      category: 'garden',
      latitude: 10.767,
      longitude: 106.635,
      radiusMeters: 300,
      openAt: { dayOfWeek: 5, minutes: 600 },
      limit: 10,
      offset: 20,
    });

    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("p.status = 'published'");
    expect(sql).toContain("to_tsvector('simple', search_normalize");
    expect(sql).toContain('ST_DWithin');
    expect(sql).toContain('poi_operating_hours');
    expect(sql).toContain('ORDER BY final_score DESC, id ASC');
    expect(sql).toContain('COUNT(*) OVER()');
    expect(sql).toContain('t.locale AS resolved_locale');
    expect(sql).toContain('jsonb_build_object(\n          resolved_locale');
    expect(sql).toContain('unnest($3::text[])'); // OR terms, min-match filter
    expect(values).toEqual([
      'vuon cau vong',
      'vi',
      ['vuon', 'cau', 'vong'],
      2,
      'vuon | cau | vong',
      'garden',
      106.635,
      10.767,
      300,
      5,
      '10:00',
      10,
      20,
    ]);
  });
});
