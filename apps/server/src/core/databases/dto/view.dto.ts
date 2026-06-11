import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateViewDto {
  @IsUUID()
  databaseId: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsIn(['table'])
  type: string;

  @IsOptional()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  position?: string;
}

export class UpdateViewDto {
  @IsUUID()
  viewId: string;

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

export class DeleteViewDto {
  @IsUUID()
  viewId: string;
}
