import { Allow, IsUUID } from 'class-validator';

export class UpdatePropertyValueDto {
  @IsUUID()
  recordId: string;

  @IsUUID()
  propertyId: string;

  @Allow()
  value: unknown;
}
