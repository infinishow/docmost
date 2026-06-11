import { IsUUID } from 'class-validator';

export class UpdatePropertyValueDto {
  @IsUUID()
  recordId: string;

  @IsUUID()
  propertyId: string;

  value: unknown;
}
