import { describe, expect, it } from 'vitest';
import { pickNextStop } from './next-stop';

const at = (latitude: number, longitude = 106.64) => ({ latitude, longitude });
const pois = [
  { slug: 'p06-tiem-ca-phe-sai-gon', category: 'food', location: at(10.7661) },
  { slug: 'svc-food-2', category: 'food', location: at(10.7665) },
  { slug: 'svc-wc-3', category: 'restroom', location: at(10.7662) },
  { slug: 'svc-wc-access-1', category: 'restroom', location: at(10.7663) },
  { slug: 'svc-parking-1', category: 'parking', location: at(10.76601) },
  { slug: 'p21-power-surge', category: 'thrill_ride', location: at(10.7664) },
  {
    slug: 'p40-quang-truong-au-lac',
    category: 'landmark',
    location: at(10.766),
  },
  { slug: 'p01-cong-so-1', category: 'gate', location: at(10.7669) },
  { slug: 'p02-cong-so-1a', category: 'gate', location: at(10.7675) },
];
const here = at(10.766);

describe('next stop', () => {
  it('finds food that is not a café to eat', () => {
    expect(pickNextStop('eat', here, pois)?.poi.slug).toBe('svc-food-2');
  });
  it('finds the nearest toilet, accessible ones included', () => {
    expect(pickNextStop('toilet', here, pois)?.poi.slug).toBe('svc-wc-3');
    expect(
      pickNextStop(
        'toilet',
        here,
        pois.filter((p) => p.slug !== 'svc-wc-3'),
      )?.poi.slug,
    ).toBe('svc-wc-access-1');
  });
  it('rests at a café, else any food place', () => {
    expect(pickNextStop('rest', here, pois)?.poi.slug).toBe(
      'p06-tiem-ca-phe-sai-gon',
    );
    expect(
      pickNextStop(
        'rest',
        here,
        pois.filter((p) => !p.slug.includes('ca-phe')),
      )?.poi.slug,
    ).toBe('svc-food-2');
  });
  it('plays on at a ride, not at the one the visitor stands at', () => {
    expect(pickNextStop('play', here, pois)?.poi.slug).toBe('p21-power-surge');
    const standing = [{ ...pois[5]!, location: at(10.76601) }];
    expect(pickNextStop('play', here, standing)).toBeNull();
  });
  it('goes home through the nearest gate', () => {
    expect(pickNextStop('home', here, pois)?.poi.slug).toBe('p01-cong-so-1');
  });
  it('says nothing when there is no such place', () => {
    expect(pickNextStop('home', here, [])).toBeNull();
  });
});
