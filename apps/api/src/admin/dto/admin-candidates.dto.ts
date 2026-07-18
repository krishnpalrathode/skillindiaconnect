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
}

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
