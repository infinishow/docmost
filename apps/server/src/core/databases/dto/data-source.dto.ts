import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateDataSourceDto {
  @IsUUID()
  parentPageId: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class DataSourceIdDto {
  @IsUUID()
  databaseId: string;
}

export class UpdateDataSourceDto extends DataSourceIdDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string | null;
}

export class DeleteDataSourceDto extends DataSourceIdDto {}
