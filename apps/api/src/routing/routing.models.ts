import type { GeoJsonLineString } from '@damsen/shared-types';

export interface SnappedNode {
  id: number;
  longitude: number;
  latitude: number;
  distanceMeters: number;
}

export interface RouteDestination {
  nodeId: number;
  externalNodeId: string;
}

export interface RouteSegment {
  sequence: number;
  edgeId: number;
  edgeName: string;
  distanceMeters: number;
  geometry: GeoJsonLineString;
}

export interface RoutingRepository {
  findDestination(poiId: string): Promise<RouteDestination | null>;
  snapOrigin(
    latitude: number,
    longitude: number,
    maxMeters: number,
  ): Promise<SnappedNode | null>;
  findPath(
    startNodeId: number,
    endNodeId: number,
    accessible: boolean,
  ): Promise<RouteSegment[]>;
}

export const ROUTING_REPOSITORY = Symbol('ROUTING_REPOSITORY');
