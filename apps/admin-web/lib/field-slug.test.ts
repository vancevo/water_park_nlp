import { describe, expect, it } from 'vitest';
import { makeFieldSlug } from './field-slug';

describe('makeFieldSlug', () => {
  it('turns Vietnamese names into the slug the API accepts', () => {
    expect(makeFieldSlug('Đu quay đứng', 'ab12')).toBe(
      'field-du-quay-dung-ab12',
    );
    expect(makeFieldSlug('  Nhà vệ sinh (khu B)!  ', 'x9')).toBe(
      'field-nha-ve-sinh-khu-b-x9',
    );
  });

  it('always starts with a letter and fits the API pattern', () => {
    for (const name of ['123', '', '   ', 'Đ', '###', 'a'.repeat(200)]) {
      const slug = makeFieldSlug(name, 'q1');
      expect(slug).toMatch(/^[a-z][a-z0-9-]{0,99}$/);
    }
  });

  it('adds a random suffix so two same-named places do not collide', () => {
    expect(makeFieldSlug('Cổng')).not.toBe(makeFieldSlug('Cổng'));
  });
});
