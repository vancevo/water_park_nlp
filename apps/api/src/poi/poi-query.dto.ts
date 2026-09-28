import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class PoiListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  lng?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(5000)
  radius?: number;

  @IsOptional()
  @IsString()
  @Matches(/^[a-z][a-z0-9_-]{0,49}$/)
  category?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  })
  @IsBoolean()
  openNow?: boolean;

  @IsOptional()
  @IsIn(['vi', 'en'])
  locale: 'vi' | 'en' = 'vi';
}

export class PoiDetailQueryDto {
  @IsOptional()
  @IsIn(['vi', 'en'])
  locale: 'vi' | 'en' = 'vi';
}
