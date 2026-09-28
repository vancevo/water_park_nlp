import {
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { GeoJsonLineString, RouteResponse } from '@damsen/shared-types';
import { randomUUID } from 'node:crypto';

import type { CreateRouteDto } from './routing.dto.js';
import {
  ROUTING_REPOSITORY,
  type RoutingRepository,
} from './routing.models.js';

const MAX_SNAP_DISTANCE_METERS = 75;
const WALKING_SPEED_METERS_PER_SECOND = 1.2;

@Injectable()
export class RoutingService {
  constructor(
    @Inject(ROUTING_REPOSITORY)
    private readonly repository: RoutingRepository,
  ) {}

  async create(input: CreateRouteDto): Promise<RouteResponse> {
    const destination = await this.repository.findDestination(input.poiId);
    if (!destination) {
      throw new NotFoundException({
        code: 'ROUTE_DESTINATION_NOT_FOUND',
        message: 'Published POI has no active primary entrance',
        details: { poiId: input.poiId },
      });
    }

    const origin = await this.repository.snapOrigin(
      input.from.lat,
      input.from.lng,
      MAX_SNAP_DISTANCE_METERS,
    );
    if (!origin) {
      throw new UnprocessableEntityException({
        code: 'ORIGIN_OUTSIDE_ROUTABLE_AREA',
        message: `No walkway is within ${MAX_SNAP_DISTANCE_METERS} metres of the current position`,
        details: { maxSnapDistanceMeters: MAX_SNAP_DISTANCE_METERS },
      });
    }

    const segments = await this.repository.findPath(
      origin.id,
      destination.nodeId,
      input.accessible,
    );
    if (origin.id !== destination.nodeId && segments.length === 0) {
      throw new UnprocessableEntityException({
        code: 'ROUTE_NOT_FOUND',
        message: 'No eligible walkway route is available',
        details: { accessible: input.accessible },
      });
    }

    const coordinates: GeoJsonLineString['coordinates'] = [];
    for (const segment of segments) {
      for (const coordinate of segment.geometry.coordinates) {
        const previous = coordinates.at(-1);
        if (
          !previous ||
          previous[0] !== coordinate[0] ||
          previous[1] !== coordinate[1]
        ) {
          coordinates.push(coordinate);
        }
      }
    }
    if (coordinates.length === 0) {
      coordinates.push(
        [origin.longitude, origin.latitude],
        [origin.longitude, origin.latitude],
      );
    }

    const distanceMeters = segments.reduce(
      (total, segment) => total + segment.distanceMeters,
      0,
    );
    return {
      routeId: randomUUID(),
      version: 1,
      geometry: { type: 'LineString', coordinates },
      distanceMeters: Math.round(distanceMeters * 10) / 10,
      etaSeconds: Math.ceil(distanceMeters / WALKING_SPEED_METERS_PER_SECOND),
      steps: segments.map((segment, index) => ({
        sequence: index + 1,
        instruction: `Continue along ${segment.edgeName}`,
        distanceMeters: Math.round(segment.distanceMeters * 10) / 10,
      })),
    };
  }
}
