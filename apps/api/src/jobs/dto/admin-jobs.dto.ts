import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { JobStatus } from '@prisma/client';
import { CreateJobDto } from './create-job.dto';

const toBool = ({ value }: { value: unknown }) =>
  value === 'true' || value === true ? true : value === 'false' || value === false ? false : value;

export class ListAdminJobsDto {
  @IsOptional()
  @IsEnum(JobStatus)
  status?: JobStatus;

  @IsOptional()
  @IsUUID()
  employerId?: string;

  /** Matches job title or company name. */
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  featured?: boolean;

  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  urgent?: boolean;

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
}

export const REVIEW_DECISIONS = ['APPROVE', 'REJECT'] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

export class ReviewJobDto {
  @IsIn(REVIEW_DECISIONS)
  decision!: ReviewDecision;

  /** Required for REJECT (service-enforced → 422 REVIEW_REASON_REQUIRED); employer-visible. */
  @IsOptional()
  @IsString()
  @Length(1, 500)
  reason?: string;
}

/** Optional reason on pause/archive — the frozen contract defines no mandatory body. */
export class AdminJobActionDto {
  @IsOptional()
  @IsString()
  @Length(1, 500)
  reason?: string;
}

export class JobFlagsDto {
  @IsOptional()
  @IsBoolean()
  featured?: boolean;

  @IsOptional()
  @IsBoolean()
  urgent?: boolean;
}

/** On-behalf creation: the standard create shape + the target employer (+ publish). */
export class OnBehalfCreateJobDto extends CreateJobDto {
  @IsUUID()
  employerId!: string;

  @IsOptional()
  @IsBoolean()
  publish?: boolean;
}
