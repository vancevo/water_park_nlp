import { distanceMeters } from './walk-nodes';

export interface LatLng {
  latitude: number;
  longitude: number;
}

/** Initial compass bearing from `from` to `to`, degrees clockwise from north (0–360). */
export function bearingDegrees(from: LatLng, to: LatLng): number {
  const rad = Math.PI / 180;
  const dLon = (to.longitude - from.longitude) * rad;
  const lat1 = from.latitude * rad;
  const lat2 = to.latitude * rad;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) / rad + 360) % 360;
}

const POINTS = [
  'Bắc',
  'Đông Bắc',
  'Đông',
  'Đông Nam',
  'Nam',
  'Tây Nam',
  'Tây',
  'Tây Bắc',
] as const;

/** Vietnamese compass word for a bearing. */
export function compassWord(bearing: number): (typeof POINTS)[number] {
  return POINTS[Math.round((((bearing % 360) + 360) % 360) / 45) % 8]!;
}

/** "42 m về hướng Đông Bắc" (or "ngay tại đây" when within a few metres). */
export function describeOffset(from: LatLng, to: LatLng): string {
  const metres = distanceMeters(from, to);
  if (metres < 3) return 'ngay tại đây';
  const rounded =
    metres < 100 ? Math.round(metres) : Math.round(metres / 5) * 5;
  return `${rounded} m về hướng ${compassWord(bearingDegrees(from, to))}`;
}

export function formatMetres(metres: number): string {
  return metres < 1000
    ? `${Math.round(metres)} m`
    : `${(metres / 1000).toFixed(2)} km`;
}
