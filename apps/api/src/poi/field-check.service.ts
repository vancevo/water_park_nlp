import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { AdminPoi, FieldCheck } from '@damsen/shared-types';

import type {
  ApplyFieldCheckDto,
  CreateFieldCheckDto,
} from './field-check.dto.js';
import {
  FIELD_CHECK_REPOSITORY,
  type FieldCheckRecord,
  type FieldCheckRepository,
} from './field-check.models.js';
import {
  POI_REPOSITORY,
  type PoiRecord,
  type PoiRepository,
} from './poi.models.js';

/** A fix worse than this cannot tell two nearby places apart; the device must retry. */
export const MAX_FIELD_ACCURACY_METERS = 50;
const LIST_LIMIT = 500;
const EARTH_RADIUS_METERS = 6_371_000;

export function haversineMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLon = (b.longitude - a.longitude) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * rad) *
      Math.cos(b.latitude * rad) *
      Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}

function toDto(record: FieldCheckRecord): FieldCheck {
  return {
    id: record.id,
    poiId: record.poiId,
    clientId: record.clientId,
    target: record.target,
    ...(record.entranceId ? { entranceId: record.entranceId } : {}),
    location: { latitude: record.latitude, longitude: record.longitude },
    accuracyMeters: record.accuracyMeters,
    sampleCount: record.sampleCount,
    outcome: record.outcome,
    ...(record.pathOk === undefined ? {} : { pathOk: record.pathOk }),
    ...(record.note ? { note: record.note } : {}),
    distanceFromCurrentMeters: record.distanceFromCurrentMeters,
    createdBy: record.createdBy,
    createdAt: record.createdAt.toISOString(),
    ...(record.appliedAt ? { appliedAt: record.appliedAt.toISOString() } : {}),
    ...(record.appliedBy ? { appliedBy: record.appliedBy } : {}),
  };
}

/**
 * Field verification: people on site record where a place (or its entrance) really
 * is. A check is evidence and never edits the POI; a reviewer/admin applies it,
 * which moves the position in place (status unchanged, audited) so a published
 * place does not disappear from visitors while being corrected.
 */
@Injectable()
export class FieldCheckService {
  constructor(
    @Inject(FIELD_CHECK_REPOSITORY)
    private readonly checks: FieldCheckRepository,
    @Inject(POI_REPOSITORY) private readonly pois: PoiRepository,
  ) {}

  async create(
    poiId: string,
    input: CreateFieldCheckDto,
    actorId: string,
  ): Promise<{ check: FieldCheck; created: boolean }> {
    const poi = await this.pois.findForAdmin(poiId);
    if (!poi) throw new NotFoundException('POI not found');
    if (input.accuracyMeters > MAX_FIELD_ACCURACY_METERS) {
      throw new UnprocessableEntityException({
        code: 'FIELD_CHECK_ACCURACY_TOO_LOW',
        message: `GPS accuracy ${Math.round(input.accuracyMeters)} m is worse than ${MAX_FIELD_ACCURACY_METERS} m; measure again in the open`,
      });
    }
    const reference = this.referencePoint(poi, input);
    const record: FieldCheckRecord = {
      id: randomUUID(),
      clientId: input.clientId,
      poiId,
      target: input.target,
      ...(input.entranceId ? { entranceId: input.entranceId } : {}),
      latitude: input.location.latitude,
      longitude: input.location.longitude,
      accuracyMeters: input.accuracyMeters,
      sampleCount: input.sampleCount,
      outcome: input.outcome,
      ...(input.pathOk === undefined ? {} : { pathOk: input.pathOk }),
      ...(input.note?.trim() ? { note: input.note.trim() } : {}),
      distanceFromCurrentMeters: haversineMeters(input.location, reference),
      createdBy: actorId,
      createdAt: new Date(),
    };
    const stored = await this.checks.create(record);
    if (!stored.created && stored.record.poiId !== poiId) {
      throw new ConflictException('clientId already used for another POI');
    }
    return { check: toDto(stored.record), created: stored.created };
  }

  async list(filter: {
    poiId?: string;
    unappliedOnly?: boolean;
  }): Promise<FieldCheck[]> {
    return (await this.checks.list({ ...filter, limit: LIST_LIMIT })).map(
      toDto,
    );
  }

  async apply(
    checkId: string,
    input: ApplyFieldCheckDto,
    actorId: string,
  ): Promise<AdminPoi> {
    const check = await this.checks.find(checkId);
    if (!check) throw new NotFoundException('Field check not found');
    if (check.appliedAt) {
      throw new ConflictException('Field check was already applied');
    }
    const before = await this.pois.findForAdmin(check.poiId);
    if (!before) throw new NotFoundException('POI not found');
    if (before.status === 'pending_review') {
      throw new ConflictException('Pending content cannot be edited');
    }
    const after: PoiRecord = structuredClone(before);
    if (check.target === 'poi') {
      after.latitude = check.latitude;
      after.longitude = check.longitude;
    } else {
      const entrance = after.entrances.find(
        (item) => item.id === check.entranceId,
      );
      if (!entrance) {
        throw new ConflictException('The entrance no longer exists');
      }
      if (!input.graphNodeRef) {
        throw new BadRequestException(
          'graphNodeRef is required when applying an entrance check',
        );
      }
      entrance.location = {
        latitude: check.latitude,
        longitude: check.longitude,
      };
      entrance.graphNodeRef = input.graphNodeRef;
    }
    await this.pois.save(after); // status unchanged: a published place stays published
    await this.pois.saveAudit({
      id: randomUUID(),
      actorId,
      action: 'poi.location_corrected',
      entityId: after.id,
      before,
      after,
      createdAt: new Date(),
    });
    await this.checks.markApplied(checkId, actorId, new Date());
    return {
      id: after.id,
      slug: after.slug,
      category: after.category,
      status: after.status,
      location: { latitude: after.latitude, longitude: after.longitude },
      translations: Object.values(after.translations).filter(
        (item): item is NonNullable<typeof item> => Boolean(item),
      ),
      entrances: after.entrances,
      operatingHours: after.operatingHours,
      ...(after.pendingVersionId
        ? { pendingVersionId: after.pendingVersionId }
        : {}),
      ...(after.rejectionReason
        ? { rejectionReason: after.rejectionReason }
        : {}),
    };
  }

  private referencePoint(
    poi: PoiRecord,
    input: CreateFieldCheckDto,
  ): { latitude: number; longitude: number } {
    if (input.target === 'poi') {
      return { latitude: poi.latitude, longitude: poi.longitude };
    }
    if (!input.entranceId) {
      throw new BadRequestException(
        'entranceId is required for an entrance check',
      );
    }
    const entrance = poi.entrances.find((item) => item.id === input.entranceId);
    if (!entrance) throw new NotFoundException('Entrance not found');
    return entrance.location;
  }
}
