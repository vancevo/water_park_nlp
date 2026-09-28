import type { LineString } from 'geojson';

export interface RoutePoint {
  lat: number;
  lng: number;
}

export interface RouteStep {
  sequence: number;
  instruction: string;
  distanceMeters: number;
}

export interface NavigationRoute {
  routeId: string;
  version: number;
  geometry: LineString;
  distanceMeters: number;
  etaSeconds: number;
  steps: RouteStep[];
}

export interface CreateRouteInput {
  from: RoutePoint;
  poiId: string;
  accessible: boolean;
  signal?: AbortSignal;
}

/** Temporary boundary to replace with the generated T33 OpenAPI client. */
export interface RouteClient {
  createRoute(input: CreateRouteInput): Promise<NavigationRoute>;
}
