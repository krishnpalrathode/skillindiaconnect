import { ApplicationStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class ListAdminApplicationsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @IsOptional()
  @IsEnum(ApplicationStatus)
  status?: ApplicationStatus;

  @IsOptional()
  @IsString()
  jobId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
  /** `field:dir`; an unknown field falls back to the default rather than 400ing. */
  @IsOptional()
  @IsString()
  sort?: string;
}

/**
 * Sortable columns for the admin applications table (whitelisted).
 *
 * NOT sortable: candidateName and jobTitle. Both are resolved AFTER the page
 * query (batched name/job lookups, to avoid N+1), so an orderBy cannot reach
 * them — a header offering them would sort by something else entirely.
 */
export const ADMIN_APPLICATION_SORT = {
  status: 'status',
  match: 'matchScore',
  applied: 'createdAt',
} as const;

export const ADMIN_APPLICATION_SORT_DEFAULT = 'applied:desc';
