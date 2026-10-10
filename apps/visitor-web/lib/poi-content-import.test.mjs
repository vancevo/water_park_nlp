import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  matchRows,
  norm,
  parseEnglish,
  parseSource,
  validateRows,
} from '../../../scripts/import-poi-content.mjs';

const source = readFileSync(
  join(import.meta.dirname, '../../../data/pois/poi-content.source.txt'),
  'utf8',
);
const poi = (slug, name, id = slug) => ({
  id,
  slug,
  status: 'published',
  translations: [
    { locale: 'vi', name, shortDescription: '', longDescription: '' },
  ],
});

describe('poi content source', () => {
  const rows = parseSource(source);

  it('has the 79 places: 50 numbered 1..50 and 29 without a number', () => {
    expect(rows).toHaveLength(79);
    expect(
      rows.filter((row) => row.mapNumber !== null).map((r) => r.mapNumber),
    ).toEqual(Array.from({ length: 50 }, (_, index) => index + 1));
    expect(rows.filter((row) => row.mapNumber === null)).toHaveLength(29);
  });

  it('has four non-empty text fields per place within the limits, no duplicates', () => {
    expect(validateRows(rows)).toEqual([]);
  });

  it('rejects an empty field or a malformed line', () => {
    expect(() => parseSource('1|a|b|c')).toThrow(/7 fields/);
    const broken = parseSource('1|Tên|Loại||Dài|Đọc|');
    expect(validateRows(broken).join()).toMatch(/empty short/);
  });
});

describe('matching to existing places', () => {
  const rows = parseSource(source);
  const gate = rows.find((row) => row.mapNumber === 1);
  const restaurant39 = rows.find((row) => row.mapNumber === 39);
  const thuyTaRestaurant = rows.find((row) => row.name === 'Nhà hàng Thủy Tạ');

  it('normalises dashes, spacing and Unicode form', () => {
    expect(norm('Cổng  số 1 — đường')).toBe(norm('Cổng số 1 - đường'));
    expect(norm('Cổng'.normalize('NFD'))).toBe(norm('Cổng'));
  });

  it('matches by name and map number, one to one', () => {
    const pois = [
      poi('p01-cong-so-1', gate.name),
      poi('p39-nha-hang', restaurant39.name),
      poi('new-nha-hang-thuy-ta', thuyTaRestaurant.name),
    ];
    const result = matchRows([gate, restaurant39, thuyTaRestaurant], pois);
    expect(result.map((m) => m.poi?.slug)).toEqual([
      'p01-cong-so-1',
      'p39-nha-hang',
      'new-nha-hang-thuy-ta',
    ]);
  });

  it('never fuzzy-matches: a different name or number is reported, not written', () => {
    const wrongName = matchRows([gate], [poi('p01-x', 'Cổng số 1')]);
    expect(wrongName[0].error).toMatch(/name differs/);
    const noPlace = matchRows([gate], []);
    expect(noPlace[0].error).toMatch(/no place with this number/);
    // "Nhà hàng" (39) must not catch "Nhà hàng Thủy Tạ", nor the reverse
    const mixed = matchRows(
      [restaurant39],
      [poi('new-nha-hang-thuy-ta', thuyTaRestaurant.name)],
    );
    expect(mixed[0].poi).toBeUndefined();
  });

  it('reports two places with the same number and name as ambiguous', () => {
    const result = matchRows(
      [gate],
      [poi('p01-a', gate.name, 'a'), poi('p01-b', gate.name, 'b')],
    );
    expect(result[0].error).toBe('ambiguous');
  });
});

describe('poi content English narration', () => {
  const english = parseEnglish(
    readFileSync(
      join(import.meta.dirname, '../../../data/pois/poi-content.en.txt'),
      'utf8',
    ),
  );

  it('has an English narration for every source row, and no extras', () => {
    const rows = parseSource(source);
    const keys = rows.map((row) => `${row.mapNumber ?? ''}|${norm(row.name)}`);
    expect([...english.keys()].sort()).toEqual([...keys].sort());
  });

  it('is English text, not a copy of the Vietnamese', () => {
    const rows = parseSource(source);
    for (const row of rows) {
      const text = english.get(`${row.mapNumber ?? ''}|${norm(row.name)}`);
      expect(text).not.toBe(row.narration);
      expect(text).toMatch(/^[\x20-\x7eéÉ–—’']+$/);
    }
  });
});
