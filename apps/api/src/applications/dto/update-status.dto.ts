import { ApplicationStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

/** Employer forward-only status change. `rejectionFeedback` is optional (REJECTED only). */
export class UpdateStatusDto {
  @IsEnum(ApplicationStatus)
  status!: ApplicationStatus;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  rejectionFeedback?: string;
}
