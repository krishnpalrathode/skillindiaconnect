import { IsEnum, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { Currency, JobMarket } from '@prisma/client';

/**
 * SEC-002 (S8-H2) — strip NUL bytes from free-text query input.
 *
 * Postgres `text` cannot represent U+0000: the driver reports
 * `22021 invalid byte sequence for encoding "UTF8": 0x00` and the request died
 * as an unhandled 500. Not an injection (the value stayed a bound parameter and
 * nothing was executed), but an unauthenticated one-byte request that reliably
 * produces a server error and an ERROR-level log line is both an error-hygiene
 * defect and cheap log-flooding leverage.
 *
 * Stripping rather than rejecting: a NUL is never meaningful in a search term,
 * so the useful reading of `welder\0DROP` is `welderDROP` — a 400 here would
 * only convert an unusable response into a different unusable response.
 */
const stripNul = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.replace(/\0/g, '') : value;

export class SearchQueryDto {
  @IsOptional()
  @Transform(stripNul)
  @IsString()
  // Bounds the FTS parse cost; the corpus has no terms remotely this long.
  @MaxLength(200)
  q?: string;

  @IsOptional()
  @IsEnum(JobMarket)
  market?: JobMarket;

  /** Category slug (e.g. "plumbing") — whitelisted filter, not arbitrary field access */
  @IsOptional()
  @Transform(stripNul) // SEC-002 — also reaches the raw query as a bound param
  @IsString()
  @MaxLength(100)
  category?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  salaryMin?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  salaryMax?: number;

  @IsOptional()
  @IsEnum(Currency)
  currency?: Currency;

  @IsOptional()
  @IsIn(['featured', 'urgent', 'new'])
  badge?: 'featured' | 'urgent' | 'new';

  @IsOptional()
  @IsIn(['relevance', 'recent', 'salary'])
  sort?: 'relevance' | 'recent' | 'salary';

  /** Opaque base64url cursor from a previous response's nextCursor */
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
