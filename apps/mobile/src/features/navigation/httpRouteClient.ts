import type { LineString } from 'geojson';

import type {
  CreateRouteInput,
  NavigationRoute,
  RouteClient,
  RouteStep,
} from './model';

interface RouteWireResponse {
  routeId: unknown;
  version: unknown;
  geometry: unknown;
  distanceMeters: unknown;
  etaSeconds: unknown;
  steps: unknown;
}

export class RouteRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'RouteRequestError';
  }
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isLineString(value: unknown): value is LineString {
  if (!value || typeof value !== 'object') return false;
  const geometry = value as Partial<LineString>;
  return (
    geometry.type === 'LineString' &&
    Array.isArray(geometry.coordinates) &&
    geometry.coordinates.length >= 2 &&
    geometry.coordinates.every(
      (coordinate) =>
        Array.isArray(coordinate) &&
        coordinate.length >= 2 &&
        coordinate.slice(0, 2).every(Number.isFinite),
    )
  );
}

function isRouteStep(value: unknown): value is RouteStep {
  if (!value || typeof value !== 'object') return false;
  const step = value as Partial<RouteStep>;
  return (
    typeof step.sequence === 'number' &&
    Number.isInteger(step.sequence) &&
    step.sequence >= 0 &&
    typeof step.instruction === 'string' &&
    finiteNonNegative(step.distanceMeters)
  );
}

function normalize(payload: RouteWireResponse): NavigationRoute {
  if (
    typeof payload.routeId !== 'string' ||
    typeof payload.version !== 'number' ||
    !Number.isInteger(payload.version) ||
    !isLineString(payload.geometry) ||
    !finiteNonNegative(payload.distanceMeters) ||
    !finiteNonNegative(payload.etaSeconds) ||
    !Array.isArray(payload.steps) ||
    !payload.steps.every(isRouteStep)
  ) {
    throw new RouteRequestError('Route response is invalid.', 502);
  }

  return {
    routeId: payload.routeId,
    version: payload.version,
    geometry: payload.geometry,
    distanceMeters: payload.distanceMeters,
    etaSeconds: payload.etaSeconds,
    steps: payload.steps,
  };
}

export function createHttpRouteClient(baseUrl: string): RouteClient {
  return {
    async createRoute({ signal, ...input }: CreateRouteInput) {
      const response = await fetch(`${baseUrl}/v1/routes`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
        signal,
      });

      if (!response.ok) {
        throw new RouteRequestError(
          'Unable to calculate route.',
          response.status,
        );
      }

      return normalize((await response.json()) as RouteWireResponse);
    },
  };
}
