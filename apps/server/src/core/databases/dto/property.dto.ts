import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';
import { DATA_SOURCE_PROPERTY_TYPES } from '../services/property-value-normalizer';

export class CreatePropertyDto {
  @IsUUID()
  databaseId: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsIn(DATA_SOURCE_PROPERTY_TYPES)
  type: string;

  @IsOptional()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  position?: string;
}

export class UpdatePropertyDto {
  @IsUUID()
  propertyId: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  position?: string;
}

export class DeletePropertyDto {
  @IsUUID()
  propertyId: string;
}
