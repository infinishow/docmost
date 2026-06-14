import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class QueryRecordsDto {
  @IsUUID()
  databaseId: string;

  @IsOptional()
  @IsUUID()
  viewId?: string;

  @IsOptional()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  filter?: unknown;

  @IsOptional()
  sort?: unknown;
}
