import { IsObject, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateRecordDto {
  @IsUUID()
  databaseId: string;

  @IsOptional()
  @IsString()
  position?: string;

  @IsOptional()
  @IsObject()
  values?: Record<string, unknown>;
}

export class UpdateRecordDto {
  @IsUUID()
  recordId: string;

  @IsOptional()
  @IsString()
  position?: string;
}

export class DeleteRecordDto {
  @IsUUID()
  recordId: string;
}
