import { describe, expect, it, vi } from 'vitest';

import type { SqlClient } from '../src/poi/postgres-poi.repository.js';
import { PostgresRoutingRepository } from '../src/routing/postgres-routing.repository.js';

describe('PostgresRoutingRepository', () => {
  it('resolves only the published active primary entrance node', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await new PostgresRoutingRepository({ query } as SqlClient).findDestination(
      'poi-id',
    );
    expect(query.mock.calls[0]?.[0]).toContain("p.status = 'published'");
    expect(query.mock.calls[0]?.[0]).toContain(
      'pe.is_primary AND pe.is_active',
    );
  });

  it('uses bounded PostGIS snapping', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await new PostgresRoutingRepository({ query } as SqlClient).snapOrigin(
      10.767,
      106.635,
      75,
    );
    expect(query.mock.calls[0]?.[0]).toContain('ST_DWithin');
    expect(query.mock.calls[0]?.[1]).toEqual([106.635, 10.767, 75]);
  });

  it('uses pgRouting and excludes closed and inaccessible edges', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await new PostgresRoutingRepository({ query } as SqlClient).findPath(
      1,
      7,
      true,
    );
    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('pgr_dijkstra');
    expect(sql).toContain('$1::text');
    expect(sql).toContain('$2::bigint');
    expect(sql).toContain('$3::bigint');
    expect(values[0]).toContain("status = 'open'");
    expect(values[0]).toContain("accessibility <> 'stairs'");
    expect(values.slice(1)).toEqual([1, 7]);
  });
});
