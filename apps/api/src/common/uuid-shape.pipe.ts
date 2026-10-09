import { BadRequestException, type PipeTransform } from '@nestjs/common';

const UUID_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/**
 * Shape-only UUID check (8-4-4-4-12 hex) for narration and TTS job ids (I04).
 * Migration 006 seeds narrations with md5-derived ids whose version AND
 * variant nibbles are arbitrary, so Nest's `ParseUUIDPipe` (RFC 4122, any
 * version) still rejected some of them. Postgres `uuid` accepts any such
 * value; ids are always bound as query parameters. POI ids keep the v4 pipe.
 */
export class ParseUuidShapePipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (typeof value !== 'string' || !UUID_SHAPE.test(value)) {
      throw new BadRequestException('Validation failed (uuid is expected)');
    }
    return value;
  }
}
