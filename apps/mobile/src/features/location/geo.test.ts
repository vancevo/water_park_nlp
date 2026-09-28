import { describe, expect, it } from 'vitest';

import { accuracyCircle } from './geo';

describe('accuracyCircle', () => {
  it('creates a closed polygon around the GPS sample', () => {
    const feature = accuracyCircle(10.7682, 106.6358, 25, 12);
    const ring = feature.geometry.coordinates[0];

    expect(ring).toHaveLength(13);
    expect(ring?.[0]).toEqual(ring?.[12]);
    expect(feature.geometry.type).toBe('Polygon');
  });
});
