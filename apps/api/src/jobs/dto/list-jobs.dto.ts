import { IsEnum, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { JobStatus } from '@prisma/client';

const SORT_OPTIONS = [
  'createdAt:desc',
  'createdAt:asc',
  'publishedAt:desc',
  'publishedAt:asc',
  'title:asc',
  'title:desc',
] as const;

export class ListJobsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 20;

  @IsOptional()
  @IsIn(SORT_OPTIONS)
  sort: string = 'createdAt:desc';

  @IsOptional()
  @IsEnum(JobStatus)
  status?: JobStatus;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}
