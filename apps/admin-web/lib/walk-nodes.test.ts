import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MAX_SNAP_METERS,
  distanceMeters,
  nearestWalkNode,
  type WalkNode,
} from './walk-nodes';

const nodes: WalkNode[] = [
  { ref: 'osm-1', lat: 10.7658, lon: 106.638 },
  { ref: 'osm-2', lat: 10.767, lon: 106.6395 },
  { ref: 'osm-3', lat: 10.7621, lon: 106.6379 },
];

describe('walk nodes', () => {
  it('measures distances in metres', () => {
    // 0.001° of latitude is about 111 m.
    const metres = distanceMeters(
      { latitude: 10, longitude: 106 },
      { latitude: 10.001, longitude: 106 },
    );
    expect(metres).toBeGreaterThan(110);
    expect(metres).toBeLessThan(112);
  });

  it('snaps to the closest node and reports how far it is', () => {
    const snap = nearestWalkNode(nodes, {
      latitude: 10.76585,
      longitude: 106.63805,
    });
    expect(snap?.node.ref).toBe('osm-1');
    expect(snap?.distanceMeters).toBeLessThan(10);
  });

  it('flags a point too far from any path (route would be refused)', () => {
    const snap = nearestWalkNode(nodes, { latitude: 10.7, longitude: 106.6 });
    expect(snap!.distanceMeters).toBeGreaterThan(MAX_SNAP_METERS);
  });

  it('returns null without nodes', () => {
    expect(nearestWalkNode([], { latitude: 1, longitude: 1 })).toBeNull();
  });

  it('ships a node list that matches the routing graph naming', () => {
    const shipped = JSON.parse(
      readFileSync(
        join(__dirname, '../public/data/osm-walk-nodes.json'),
        'utf8',
      ),
    ) as WalkNode[];
    expect(shipped.length).toBeGreaterThan(200);
    for (const node of shipped) expect(node.ref).toMatch(/^nw-\d+$/);
    // Gate 1 (pin 1 of the official map) sits within snapping range of the paths.
    const places = JSON.parse(
      readFileSync(
        join(__dirname, '../../../data/walkways-new/damsen-pois-new.json'),
        'utf8',
      ),
    ) as { pois: { number: number; latitude: number; longitude: number }[] };
    const gate1 = places.pois.find((place) => place.number === 1)!;
    const snap = nearestWalkNode(shipped, gate1);
    expect(snap!.distanceMeters).toBeLessThan(MAX_SNAP_METERS);
  });
});
