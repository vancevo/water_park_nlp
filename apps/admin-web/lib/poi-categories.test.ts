import { describe, expect, it } from 'vitest';
import { POI_CATEGORIES, categoryOptions } from './poi-categories';

describe('poi categories', () => {
  it('has unique slugs the API accepts', () => {
    const slugs = POI_CATEGORIES.map((item) => item.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z][a-z0-9_-]{0,49}$/);
  });

  it('covers gates, rides and stages', () => {
    const slugs = POI_CATEGORIES.map((item) => item.slug);
    expect(slugs).toEqual(expect.arrayContaining(['gate', 'ride', 'show']));
  });

  it('keeps an unknown existing category selectable', () => {
    expect(categoryOptions('legacy')[0]).toMatchObject({ slug: 'legacy' });
    expect(categoryOptions('gate')).toHaveLength(POI_CATEGORIES.length);
  });
});
