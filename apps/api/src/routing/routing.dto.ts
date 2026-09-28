import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsLatitude,
  IsLongitude,
  IsUUID,
  ValidateNested,
} from 'class-validator';

class RouteOriginDto {
  @Type(() => Number)
  @IsLatitude()
  lat!: number;

  @Type(() => Number)
  @IsLongitude()
  lng!: number;
}

export class CreateRouteDto {
  @ValidateNested()
  @Type(() => RouteOriginDto)
  from!: RouteOriginDto;

  @IsUUID('4')
  poiId!: string;

  @IsBoolean()
  accessible = false;
}
