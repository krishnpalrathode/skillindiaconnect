import { ApplicationStatus } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Admin corrective (override) status change. `overrideReason` is MANDATORY — a
 * missing/empty reason is rejected (422 OVERRIDE_REASON_REQUIRED) before any write.
 * `@IsNotEmpty` guards the empty-string case; the service also trims-and-checks
 * defensively so whitespace-only never slips through.
 */
export class AdminOverrideDto {
  @IsEnum(ApplicationStatus)
  status!: ApplicationStatus;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  overrideReason!: string;
}
