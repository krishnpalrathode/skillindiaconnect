import { ApplicationStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Admin corrective (override) status change. `overrideReason` is MANDATORY — a
 * missing/empty/whitespace reason is rejected with the DOMAIN code
 * 422 OVERRIDE_REASON_REQUIRED before any write.
 *
 * It is `@IsOptional` at the DTO layer ON PURPOSE: enforcement lives in the
 * StatusService (`!reason || reason.trim() === ''`), so absent, empty, AND
 * whitespace-only reasons all funnel to the SAME 422 domain error — rather than an
 * absent field short-circuiting to a generic 400 class-validator message while a
 * whitespace reason returns the 422. `@IsString`/`@MaxLength` still bound the type
 * and length when a value IS provided.
 */
export class AdminOverrideDto {
  @IsEnum(ApplicationStatus)
  status!: ApplicationStatus;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  overrideReason?: string;
}
