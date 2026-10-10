import { describe, expect, it } from 'vitest';
import { emptyPoiDraft } from './poi-contract';
import { withPrimaryEntrance } from './poi-entrance';

const nodes = [
  { ref: 'nw-1', lon: 106.6365, lat: 10.7681 },
  { ref: 'nw-2', lon: 106.637, lat: 10.7686 },
];

describe('withPrimaryEntrance', () => {
  it('attaches a place without an entrance node to the nearest walkway node', () => {
    const draft = emptyPoiDraft();
    draft.location = { latitude: 10.7685, longitude: 106.6369 };
    const result = withPrimaryEntrance(draft, draft.location, nodes);
    expect(result.entrances).toHaveLength(1);
    expect(result.entrances[0]).toMatchObject({
      graphNodeRef: 'nw-2',
      isPrimary: true,
      location: { latitude: 10.7686, longitude: 106.637 },
    });
  });

  it('keeps an entrance that already has a node while the place has not moved', () => {
    const draft = emptyPoiDraft();
    draft.entrances[0]!.graphNodeRef = 'nw-1';
    draft.entrances[0]!.location = { latitude: 1, longitude: 2 };
    const result = withPrimaryEntrance(draft, draft.location, nodes);
    expect(result).toBe(draft);
  });

  it('re-attaches the primary entrance when the place was moved, keeping its label', () => {
    const draft = emptyPoiDraft();
    const loaded = { ...draft.location };
    draft.entrances[0]!.graphNodeRef = 'nw-1';
    draft.entrances[0]!.labelVi = 'Cửa sau';
    draft.location = { latitude: 10.7686, longitude: 106.637 };
    const result = withPrimaryEntrance(draft, loaded, nodes);
    expect(result.entrances[0]).toMatchObject({
      graphNodeRef: 'nw-2',
      labelVi: 'Cửa sau',
    });
  });

  it('leaves the draft alone when there are no nodes', () => {
    const draft = emptyPoiDraft();
    expect(withPrimaryEntrance(draft, draft.location, [])).toBe(draft);
  });
});
