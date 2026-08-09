import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { JobStatus } from '@prisma/client';

// Sort is no longer validated as a closed literal set here. It is resolved
// against MY_JOBS_SORT (jobs.service.ts) — the single whitelist every endpoint
// now uses — which CLAMPS an unknown value to the default instead of 400ing.
// Enumerating the pairs twice was how `status` ended up sortable in the service
// but rejected at the DTO.

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
  @IsString()
  sort?: string;

  @IsOptional()
  @IsEnum(JobStatus)
  status?: JobStatus;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}
