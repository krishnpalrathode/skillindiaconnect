import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { UserStatus } from '@prisma/client';

export class ListAdminCandidatesDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  /** Filter on the candidate's own profileVisible toggle ("true" / "false"). */
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  visibility?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  /**
   * `field:dir`. Validated against ADMIN_CANDIDATE_SORT (the whitelist), not
   * here — an unknown field falls back to the default rather than 400ing, so a
   * stale bookmark still renders.
   */
  @IsOptional()
  @IsString()
  sort?: string;
}

/**
 * Sortable columns for the admin candidate table.
 *
 * Deliberately NOT every column: `phone` is absent because ordering by it is a
 * read of data the table shows masked, and a sort is enough to reconstruct it.
 */
export const ADMIN_CANDIDATE_SORT = {
  name: 'fullName',
  completion: 'completionPct',
  created: 'createdAt',
} as const;

export const ADMIN_CANDIDATE_SORT_DEFAULT = 'created:desc';

export class SuspendCandidateDto {
  /** Mandatory — written to the audit row. */
  @IsString()
  @Length(1, 500)
  reason!: string;
}

/**
 * The purge body. Both fields are OPTIONAL at the type layer on purpose: the
 * confirm/reason enforcement returns the contract's dedicated 422
 * PURGE_NOT_CONFIRMED from the service — a plain VALIDATION_ERROR would hide
 * the one code the UI is required to explain. Length still validates here.
 */
export class PurgeCandidateDto {
  @IsOptional()
  @IsString()
  @Length(1, 500)
  reason?: string;

  @IsOptional()
  @IsBoolean()
  confirm?: boolean;
}
