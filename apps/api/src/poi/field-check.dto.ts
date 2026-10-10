import { Type } from 'class-transformer';
import {
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
  ValidateNested,
} from 'class-validator';

class FieldPointDto {
  @IsNumber()
  @IsLatitude()
  latitude!: number;

  @IsNumber()
  @IsLongitude()
  longitude!: number;
}

export class CreateFieldCheckDto {
  @IsUUID('4')
  clientId!: string;

  @IsIn(['poi', 'entrance'])
  target!: 'poi' | 'entrance';

  @IsOptional()
  @IsUUID('4')
  entranceId?: string;

  @ValidateNested()
  @Type(() => FieldPointDto)
  location!: FieldPointDto;

  @IsNumber()
  @Min(0.1)
  @Max(1000)
  accuracyMeters!: number;

  @IsInt()
  @Min(1)
  @Max(10_000)
  sampleCount!: number;

  @IsIn(['confirmed', 'corrected', 'problem'])
  outcome!: 'confirmed' | 'corrected' | 'problem';

  @IsOptional()
  @IsBoolean()
  pathOk?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ApplyFieldCheckDto {
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,100}$/)
  graphNodeRef?: string;
}
