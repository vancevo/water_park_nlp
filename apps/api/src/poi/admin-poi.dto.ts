import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

class GeoPointDto {
  @IsNumber()
  @IsLatitude()
  latitude!: number;

  @IsNumber()
  @IsLongitude()
  longitude!: number;
}

class TranslationDto {
  @IsIn(['vi', 'en'])
  locale!: 'vi' | 'en';

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  shortDescription!: string;

  @IsString()
  @MinLength(1)
  longDescription!: string;
}

class EntranceDto {
  @IsOptional()
  @IsUUID('4')
  id?: string;

  @IsString()
  @MinLength(1)
  labelVi!: string;

  @IsString()
  @MinLength(1)
  labelEn!: string;

  @ValidateNested()
  @Type(() => GeoPointDto)
  location!: GeoPointDto;

  @IsString()
  @MinLength(1)
  graphNodeRef!: string;

  @IsBoolean()
  isPrimary!: boolean;

  @IsIn(['standard', 'step_free'])
  accessibility!: 'standard' | 'step_free';
}

class OperatingHoursDto {
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek!: number;

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  opensAt!: string;

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  closesAt!: string;
}

export class CreateAdminPoiDto {
  @Matches(/^[a-z][a-z0-9-]{0,99}$/)
  slug!: string;

  @Matches(/^[a-z][a-z0-9_-]{0,49}$/)
  category!: string;

  @ValidateNested()
  @Type(() => GeoPointDto)
  location!: GeoPointDto;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TranslationDto)
  translations!: TranslationDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EntranceDto)
  entrances!: EntranceDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OperatingHoursDto)
  operatingHours!: OperatingHoursDto[];
}

export class UpdateAdminPoiDto {
  @IsOptional()
  @Matches(/^[a-z][a-z0-9-]{0,99}$/)
  slug?: string;

  @IsOptional()
  @Matches(/^[a-z][a-z0-9_-]{0,49}$/)
  category?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => GeoPointDto)
  location?: GeoPointDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TranslationDto)
  translations?: TranslationDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EntranceDto)
  entrances?: EntranceDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OperatingHoursDto)
  operatingHours?: OperatingHoursDto[];
}

export class WorkflowReasonDto {
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason!: string;
}
