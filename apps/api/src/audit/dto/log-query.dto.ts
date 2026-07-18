import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { AuditStatus } from '@prisma/client';

/** Default window when the caller gives no date range. See LogQueryDto. */
export const DEFAULT_WINDOW_DAYS = 30;

/** Export bounds (the contract's documented caps). */
export const EXPORT_MAX_ROWS = 10_000;
export const EXPORT_MAX_RANGE_DAYS = 90;

/**
 * Whitelisted audit-log filters (Screen 29). Every field maps to an INDEXED or
 * structured column — nothing here can trigger a sequential scan over the trail.
 *
 * DELIBERATELY ABSENT: a free-text `q` over `meta`. The audit table is
 * append-only and unbounded, `meta` is JSONB with no GIN index, and a
 * `meta::text ILIKE '%…%'` predicate is a guaranteed full-table scan. The S6-0
 * contract documents `q` as scoped to STRUCTURED columns only — here it matches
 * `action` and `targetId`, both of which are indexed or narrow. Searching inside
 * `meta` is DECLINED; if the console ever needs it, it needs a GIN index and its
 * own design, not a LIKE.
 */
export class LogQueryDto {
  /** The B2 taxonomy chip (Auth / Admin / Candidate / Employer / Jobs / Payments / …). */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  module?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  action?: string;

  @IsOptional()
  @IsUUID()
  actorId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  targetId?: string;

  @IsOptional()
  @IsEnum(AuditStatus)
  status?: AuditStatus;

  /**
   * Inclusive date bounds. When BOTH are absent the service applies a bounded
   * default window (DEFAULT_WINDOW_DAYS) — see AuditQueryService for why this is
   * a correctness/perf requirement, not a nicety.
   */
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  /**
   * Free-text, scoped to STRUCTURED columns (action, targetId) — never `meta`.
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  /** Keyset cursor: the last row's id (a BigInt rendered as a decimal string). */
  @IsOptional()
  @IsString()
  @MaxLength(30)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
