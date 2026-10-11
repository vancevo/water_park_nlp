import { describe, expect, it } from 'vitest';

import {
  matchNeedIntent,
  needMatchesPlace,
} from '../src/search/search-need-intent.js';

const id = (query: string) => matchNeedIntent(query)?.id ?? null;

describe('need intents', () => {
  it('reads "về" (go home) and "vé" (ticket) apart when the diacritics are typed', () => {
    expect(id('tôi muốn đi về')).toBe('go-home');
    expect(id('đi về')).toBe('go-home');
    expect(id('vé')).toBe('tickets');
    expect(id('mua vé')).toBe('tickets');
  });

  it('lets the longest phrase win', () => {
    expect(id('đi vệ sinh')).toBe('toilet');
    expect(id('nhà vệ sinh cho người khuyết tật')).toBe('toilet-accessible');
    expect(id('wheelchair toilet')).toBe('toilet-accessible');
  });

  it('understands the needs in Vietnamese, English and without diacritics', () => {
    expect(id('đi tắm')).toBe('water-park');
    expect(id('di tam')).toBe('water-park');
    expect(id('I want to swim')).toBe('water-park');
    expect(id('tôi muốn ngắm cảnh trên cao')).toBe('high-view');
    expect(id('cảm giác mạnh')).toBe('thrill');
    expect(id('where is the nearest exit')).toBe('go-home');
    expect(id('I am hungry')).toBe('food');
  });

  it('sends pedal boats and gentle small-group rides to the boat dock only', () => {
    expect(id('muốn đạp vịt')).toBe('pedal-boat');
    expect(id('trò chơi nhẹ nhàng cho nhóm từ 2 đến 4 người')).toBe(
      'pedal-boat',
    );
    expect(id('pedal boat')).toBe('pedal-boat');
    const need = matchNeedIntent('đạp vịt')!;
    expect(need.slugs).toEqual(['p07-ben-thuyen']);
  });

  it('sends lotus and lake-walk queries to the Nine-Bend Bridge and God of Fortune Island', () => {
    for (const query of ['vườn sen', 'đi bộ trên hồ', 'đường đi giữa hồ']) {
      const need = matchNeedIntent(query)!;
      expect(need.id).toBe('lake-walk');
      expect(need.slugs).toEqual(['p43-cau-cuu-khuc', 'new-dao-than-tai']);
    }
  });

  it('reads a drink as a drink (cafes and restaurants), not as the water park', () => {
    for (const query of [
      'muốn mua nước uống',
      'tôi muốn mua nước uống',
      'mua nước',
    ]) {
      const need = matchNeedIntent(query)!;
      expect(need.id).toBe('coffee-drink');
      expect(need.categories).toEqual(['food']);
    }
  });

  it('reads gentle play as the boat dock, not the thrill area', () => {
    for (const query of ['vui chơi nhẹ nhàng', 'tôi muốn chơi nhẹ nhàng']) {
      expect(matchNeedIntent(query)?.slugs).toEqual(['p07-ben-thuyen']);
    }
  });

  it('sends train and sightseeing-tour queries to the monorail stations', () => {
    for (const query of [
      'xe lửa',
      'đi 1 vòng đầm sen',
      'đi một vòng đầm sen',
      'đi du ngoạn',
      'tôi muốn đi du ngoạn',
      'train ride',
    ]) {
      const need = matchNeedIntent(query)!;
      expect(need.id).toBe('train-tour');
      expect(need.slugs).toEqual([
        'p12-nha-ga-monorail-1-nha-hang-de-men',
        'p31-nha-ga-monorail-2',
      ]);
    }
  });

  it('sends ATM and cash queries to the Ferris wheel and says why', () => {
    for (const query of [
      'atm',
      'tôi cần rút tiền',
      'cây ATM gần nhất',
      'cash machine',
    ]) {
      const need = matchNeedIntent(query)!;
      expect(need.id).toBe('atm');
      expect(need.slugs).toEqual(['p25-du-quay-dung']);
      expect(need.note?.vi).toContain('ATM');
      expect(need.note?.en).toContain('ATM');
    }
  });

  it('routes service needs to the place that offers them, with the reason', () => {
    const cases: [string, string, string[]][] = [
      ['tủ gửi đồ', 'lockers', ['p04-khu-tro-choi-cam-giac-manh']],
      [
        'thuê xe lăn',
        'wheelchair-rental',
        ['p12-nha-ga-monorail-1-nha-hang-de-men', 'p31-nha-ga-monorail-2'],
      ],
      [
        'mua áo mưa',
        'raincoat',
        ['p12-nha-ga-monorail-1-nha-hang-de-men', 'p31-nha-ga-monorail-2'],
      ],
      [
        'trạm sạc',
        'charging',
        ['p12-nha-ga-monorail-1-nha-hang-de-men', 'p31-nha-ga-monorail-2'],
      ],
    ];
    for (const [query, id, slugs] of cases) {
      const need = matchNeedIntent(query)!;
      expect(need.id).toBe(id);
      expect(need.slugs).toEqual(slugs);
      expect(need.note?.vi).toBeTruthy();
    }
    // drinking water: station or café; a tap to wash feet: the toilets
    expect(matchNeedIntent('vòi nước uống')?.id).toBe('drinking-water');
    expect(matchNeedIntent('vòi nước rửa chân')?.id).toBe('wash-tap');
    expect(matchNeedIntent('vòi nước rửa chân')?.categories).toEqual([
      'restroom',
    ]);
    // plain "xe lăn" is the wheelchair rental at the stations; a toilet word makes it the accessible toilet
    expect(matchNeedIntent('xe lăn')?.id).toBe('wheelchair-rental');
    expect(matchNeedIntent('nhà vệ sinh xe lăn')?.id).toBe('toilet-accessible');
    expect(matchNeedIntent('wc xe lăn')?.id).toBe('toilet-accessible');
  });

  it('sends singing, dancing, drama and art queries to the stages', () => {
    for (const query of [
      'ca hát',
      'nhảy múa',
      'xem kịch',
      'nghệ thuật',
      'văn nghệ',
      'dance',
      'concert',
    ]) {
      const need = matchNeedIntent(query)!;
      expect(need.id).toBe('show');
      expect(need.slugs?.slice(0, 2)).toEqual([
        'p41-san-khau-ngoi-sao',
        'p14-san-khau-de-men',
      ]);
    }
  });

  it('sends "hồ sen" to God of Fortune Island and the Nine-Bend Bridge', () => {
    const need = matchNeedIntent('hồ sen')!;
    expect(need.id).toBe('lake-walk');
    expect(need.slugs).toEqual(['p43-cau-cuu-khuc', 'new-dao-than-tai']);
  });

  it('reads natural sentences: filler words do not hide the need', () => {
    const cases: [string, string][] = [
      ['Con tôi 3 tuổi muốn chơi cái gì nhẹ nhàng', 'kids'],
      ['tôi muốn xuống hồ bơi tắm', 'water-park'],
      ['điện thoại hết pin cần sạc', 'charging'],
      ['tủ để đồ', 'lockers'],
      ['how do I get out of the park', 'go-home'],
      ['tôi muốn đi dạo trên hồ', 'lake-walk'],
      ['xem hoa sen', 'lake-walk'],
      ['Tôi mỏi chân, muốn đi xe điện tham quan', 'getting-around'],
      // "near X is there a Y": Y is the need, X the place to measure from
      ['gần đu quay có nhà vệ sinh không', 'toilet'],
      ['nhà vệ sinh gần đu quay', 'toilet'],
    ];
    for (const [query, id] of cases)
      expect(matchNeedIntent(query)?.id).toBe(id);
  });

  it('keeps the left-over words for the search to judge', () => {
    expect(matchNeedIntent('nhà hàng Hương Sen')?.residual).toBe('huong sen');
    expect(matchNeedIntent('tôi muốn đi về')?.residual).toBeUndefined();
    expect(matchNeedIntent('tôi đói bụng quá')?.residual).toBeUndefined();
  });

  it('leaves queries without a need alone', () => {
    expect(id('Power Surge')).toBeNull();
    expect(id('asdfgh')).toBeNull();
    expect(id('')).toBeNull();
  });

  it('selects places by slug, prefix or category', () => {
    const gate = matchNeedIntent('lối ra')!;
    expect(
      needMatchesPlace(gate, {
        slug: 'p01-cong-so-1-duong-lac-long-quan',
        category: 'gate',
      }),
    ).toBe(true);
    // the water-park gate is a gate, but not a way home
    expect(
      needMatchesPlace(gate, { slug: 'new-cong-lien-thong', category: 'gate' }),
    ).toBe(false);
    const access = matchNeedIntent('toilet người khuyết tật')!;
    expect(
      needMatchesPlace(access, {
        slug: 'svc-wc-access-2',
        category: 'restroom',
      }),
    ).toBe(true);
    expect(
      needMatchesPlace(access, { slug: 'svc-wc-2', category: 'restroom' }),
    ).toBe(false);
  });
});
