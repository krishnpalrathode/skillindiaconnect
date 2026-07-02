import { IsEnum, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { Currency, JobMarket } from '@prisma/client';

export class SearchQueryDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsEnum(JobMarket)
  market?: JobMarket;

  /** Category slug (e.g. "plumbing") — whitelisted filter, not arbitrary field access */
  @IsOptional()
  @IsString()
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
