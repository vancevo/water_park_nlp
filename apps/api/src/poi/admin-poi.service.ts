import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AdminPoi, AuditLogEntry } from '@damsen/shared-types';

import type { CreateAdminPoiDto, UpdateAdminPoiDto } from './admin-poi.dto.js';
import {
  POI_REPOSITORY,
  type PoiRecord,
  type PoiRepository,
} from './poi.models.js';

@Injectable()
export class AdminPoiService {
  constructor(
    @Inject(POI_REPOSITORY) private readonly repository: PoiRepository,
  ) {}

  async list(): Promise<AdminPoi[]> {
    return (await this.repository.findAllForAdmin()).map((record) =>
      this.toAdmin(record),
    );
  }

  async create(input: CreateAdminPoiDto, actorId: string): Promise<AdminPoi> {
    const record = this.inputToRecord(randomUUID(), input);
    await this.ensureSlugUnique(record.slug);
    await this.repository.save(record);
    await this.audit('poi.created', actorId, record.id, null, record);
    return this.toAdmin(record);
  }

  async update(
    id: string,
    input: UpdateAdminPoiDto,
    actorId: string,
  ): Promise<AdminPoi> {
    const before = await this.requiredPoi(id);
    if (before.status === 'pending_review') {
      throw new ConflictException('Pending content cannot be edited');
    }
    const mergedInput: CreateAdminPoiDto = {
      slug: input.slug ?? before.slug,
      category: input.category ?? before.category,
      location: input.location ?? {
        latitude: before.latitude,
        longitude: before.longitude,
      },
      translations:
        input.translations ??
        Object.values(before.translations).filter(
          (item): item is NonNullable<typeof item> => Boolean(item),
        ),
      entrances: input.entrances ?? before.entrances,
      operatingHours: input.operatingHours ?? before.operatingHours,
    };
    if (mergedInput.slug !== before.slug)
      await this.ensureSlugUnique(mergedInput.slug, id);
    const after = {
      ...this.inputToRecord(id, mergedInput),
      status: 'draft' as const,
    };
    await this.repository.save(after);
    await this.audit('poi.updated', actorId, id, before, after);
    return this.toAdmin(after);
  }

  async remove(id: string, actorId: string): Promise<void> {
    const before = await this.requiredPoi(id);
    if (!['draft', 'rejected'].includes(before.status)) {
      throw new ConflictException('Only draft or rejected POIs can be deleted');
    }
    await this.repository.delete(id);
    await this.audit('poi.deleted', actorId, id, before, null);
  }

  async submit(id: string, actorId: string): Promise<AdminPoi> {
    const before = await this.requiredPoi(id);
    if (!['draft', 'rejected'].includes(before.status)) {
      throw new ConflictException(
        'Only draft or rejected content can be submitted',
      );
    }
    this.assertPublishable(before);
    const versionId = randomUUID();
    const after: PoiRecord = {
      ...before,
      status: 'pending_review',
      pendingVersionId: versionId,
      rejectionReason: undefined,
    };
    await this.repository.save(after);
    await this.repository.saveVersion({
      id: versionId,
      poiId: id,
      version: await this.repository.nextVersion(id),
      status: 'pending_review',
      snapshot: after,
      createdBy: actorId,
    });
    await this.audit('poi.submitted', actorId, id, before, after);
    return this.toAdmin(after);
  }

  async approve(versionId: string, actorId: string): Promise<AdminPoi> {
    return this.review(versionId, actorId, 'published');
  }

  async reject(
    versionId: string,
    reason: string,
    actorId: string,
  ): Promise<AdminPoi> {
    return this.review(versionId, actorId, 'rejected', reason.trim());
  }

  async auditLog(): Promise<AuditLogEntry[]> {
    return (await this.repository.findAudit()).map((entry) => ({
      id: entry.id,
      actorId: entry.actorId,
      action: entry.action,
      entityType: 'poi',
      entityId: entry.entityId,
      before: entry.before,
      after: entry.after,
      createdAt: entry.createdAt.toISOString(),
    }));
  }

  private async review(
    versionId: string,
    actorId: string,
    status: 'published' | 'rejected',
    reason?: string,
  ): Promise<AdminPoi> {
    const version = await this.repository.findVersion(versionId);
    if (!version) throw new NotFoundException('Content version not found');
    const before = await this.requiredPoi(version.poiId);
    if (
      version.status !== 'pending_review' ||
      before.status !== 'pending_review' ||
      before.pendingVersionId !== versionId
    ) {
      throw new ConflictException('Content version is not pending review');
    }
    const after: PoiRecord = {
      ...version.snapshot,
      status,
      pendingVersionId: undefined,
      rejectionReason: reason,
    };
    version.status = status;
    version.reviewedBy = actorId;
    version.reason = reason;
    await this.repository.save(after);
    await this.repository.saveVersion(version);
    await this.audit(
      status === 'published' ? 'poi.approved' : 'poi.rejected',
      actorId,
      after.id,
      before,
      after,
    );
    return this.toAdmin(after);
  }

  private assertPublishable(record: PoiRecord): void {
    if (!record.translations.vi || !record.translations.en)
      throw new BadRequestException(
        'Vietnamese and English translations are required',
      );
    if (
      !record.entrances.length ||
      !record.entrances.some((item) => item.isPrimary)
    )
      throw new BadRequestException('An active primary entrance is required');
    if (record.entrances.filter((item) => item.isPrimary).length !== 1)
      throw new BadRequestException('Exactly one primary entrance is required');
  }

  private inputToRecord(id: string, input: CreateAdminPoiDto): PoiRecord {
    const translations = Object.fromEntries(
      input.translations.map((item) => [item.locale, { ...item }]),
    );
    if (Object.keys(translations).length !== input.translations.length)
      throw new BadRequestException('Translation locales must be unique');
    return {
      id,
      slug: input.slug,
      category: input.category,
      status: 'draft',
      latitude: input.location.latitude,
      longitude: input.location.longitude,
      translations,
      entrances: input.entrances.map((item) => ({
        ...item,
        id: item.id ?? randomUUID(),
      })),
      operatingHours: input.operatingHours.map((item) => ({ ...item })),
    };
  }

  private async requiredPoi(id: string): Promise<PoiRecord> {
    const record = await this.repository.findForAdmin(id);
    if (!record) throw new NotFoundException('POI not found');
    return record;
  }

  private async ensureSlugUnique(
    slug: string,
    exceptId?: string,
  ): Promise<void> {
    if (
      (await this.repository.findAllForAdmin()).some(
        (item) => item.slug === slug && item.id !== exceptId,
      )
    )
      throw new ConflictException('POI slug already exists');
  }

  private async audit(
    action: string,
    actorId: string,
    entityId: string,
    before: PoiRecord | null,
    after: PoiRecord | null,
  ): Promise<void> {
    await this.repository.saveAudit({
      id: randomUUID(),
      actorId,
      action,
      entityId,
      before,
      after,
      createdAt: new Date(),
    });
  }

  private toAdmin(record: PoiRecord): AdminPoi {
    return {
      id: record.id,
      slug: record.slug,
      category: record.category,
      status: record.status,
      location: { latitude: record.latitude, longitude: record.longitude },
      translations: Object.values(record.translations).filter(
        (item): item is NonNullable<typeof item> => Boolean(item),
      ),
      entrances: record.entrances,
      operatingHours: record.operatingHours,
      ...(record.pendingVersionId
        ? { pendingVersionId: record.pendingVersionId }
        : {}),
      ...(record.rejectionReason
        ? { rejectionReason: record.rejectionReason }
        : {}),
    };
  }
}
