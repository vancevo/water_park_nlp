import { describe, expect, it } from 'vitest';

import { InMemorySearchRepository } from '../src/search/in-memory-search.repository.js';
import {
  parseDirectionIntent,
  selectDirectionalBand,
} from '../src/search/search-geo-intent.js';
import { SearchService } from '../src/search/search.service.js';

// In-memory fixtures (apps/api/src/poi/poi.fixtures.ts), by longitude:
// 101 < 102 < 103 < 104 < 105 (west → east); by latitude: 101 is the
// southernmost, 103 the northernmost.
const id = (n: number) => `00000000-0000-4000-8000-000000000${n}`;

function service() {
  return new SearchService(
    new InMemorySearchRepository(),
    () => new Date('2026-09-25T03:00:00.000Z'),
  );
}

async function ids(q: string, extra: Record<string, unknown> = {}) {
  const result = await service().search({
    q,
    locale: 'vi',
    limit: 20,
    offset: 0,
    ...extra,
  });
  return result.items.map((item) => item.id);
}

describe('parseDirectionIntent (C06 geo intent)', () => {
  it('reads English superlatives and plain directions', () => {
    expect(parseDirectionIntent('westernmost synthetic POI')).toEqual({
      direction: 'west',
      residual: 'synthetic poi',
    });
    expect(parseDirectionIntent('the north side of the park')).toEqual({
      direction: 'north',
      residual: 'the of the park',
    });
    expect(parseDirectionIntent('Easternmost')?.direction).toBe('east');
  });

  it('reads Vietnamese only after a direction marker', () => {
    expect(
      parseDirectionIntent('các POI giả lập ở xa nhất về phía đông'),
    ).toEqual({ direction: 'east', residual: 'cac poi gia lap' });
    expect(parseDirectionIntent('điểm chính giữa hàng phía bắc')).toEqual({
      direction: 'north',
      residual: 'chinh giua hang',
    });
    expect(parseDirectionIntent('hướng tây')?.direction).toBe('west');
    // Bare "nam/bắc/đông/tây" are ordinary words (năm, bác, đông người, tay).
    expect(parseDirectionIntent('vé năm 2026')).toBeNull();
    expect(parseDirectionIntent('chỗ đông người')).toBeNull();
  });

  it('does not guess an axis for diagonals or two directions', () => {
    expect(parseDirectionIntent('north east gate')).toBeNull();
    expect(parseDirectionIntent('phía đông bắc')).toBeNull();
    expect(parseDirectionIntent('from west to east')).toBeNull();
  });

  it('returns null when there is no direction', () => {
    expect(parseDirectionIntent('nhà hàng pizza')).toBeNull();
    expect(parseDirectionIntent('water cycle')).toBeNull();
  });
});

describe('selectDirectionalBand', () => {
  const at = (latitude: number, longitude: number) => ({
    latitude,
    longitude,
  });

  it('keeps the places level with the extreme, farthest first', () => {
    const points = [at(0, 0), at(0, 10), at(0, 9), at(0, 5)];
    expect(selectDirectionalBand(points, 'east', (p) => p)).toEqual([
      at(0, 10),
      at(0, 9),
    ]);
    expect(selectDirectionalBand(points, 'west', (p) => p)).toEqual([at(0, 0)]);
  });

  it('treats a single row (no extent) as one band', () => {
    const row = [at(5, 1), at(5, 2)];
    expect(selectDirectionalBand(row, 'north', (p) => p)).toHaveLength(2);
    expect(selectDirectionalBand([], 'south', (p) => p)).toEqual([]);
  });
});

describe('SearchService direction intent', () => {
  it('answers superlatives from position, not text', async () => {
    expect(await ids('easternmost place')).toEqual([id(105)]);
    expect(await ids('northernmost')).toEqual([id(103)]);
    expect(await ids('điểm xa nhất về phía nam')).toEqual([id(101)]);
  });

  it('returns the whole western edge, farthest first', async () => {
    expect(await ids('khu vực phía tây')).toEqual([id(101), id(102)]);
  });

  it('intersects residual text with the edge when both match', async () => {
    // Landmarks are 101, 102 and 105; only 105 is on the eastern edge.
    expect(await ids('landmark phía đông')).toEqual([id(105)]);
  });

  it('orders text matches toward the edge when none lies on it', async () => {
    // The only thrill ride (104) is not on the western edge: keep it.
    expect(await ids('thrill ride in the west', { locale: 'en' })).toEqual([
      id(104),
    ]);
  });

  it('respects the category filter when choosing the edge', async () => {
    expect(await ids('westernmost', { category: 'interactive' })).toEqual([
      id(103),
    ]);
  });

  it('leaves non-directional queries on the lexical path', async () => {
    const lexical = await ids('quang truong la ma');
    expect(lexical[0]).toBe(id(102));
  });

  it('paginates the directional result', async () => {
    const result = await service().search({
      q: 'phía tây',
      locale: 'vi',
      limit: 1,
      offset: 0,
    });
    expect(result.total).toBe(2);
    expect(result.items.map((item) => item.id)).toEqual([id(101)]);
    expect(result.nextOffset).toBe(1);
  });
});
