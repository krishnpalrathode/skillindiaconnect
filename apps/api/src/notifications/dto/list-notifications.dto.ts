import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { NotificationType } from '@prisma/client';

/** Feed filter buckets — map NotificationType values to UI filter tabs. */
export enum NotificationFilter {
  APPLICATIONS = 'applications',
  JOBS = 'jobs',
  PROFILE = 'profile',
  SYSTEM = 'system',
}

/** Which NotificationType values belong to each filter bucket. */
export const FILTER_BUCKETS: Record<NotificationFilter, NotificationType[]> = {
  [NotificationFilter.APPLICATIONS]: [
    NotificationType.APPLICATION_SELECTED,
    NotificationType.APPLICATION_SHORTLISTED,
    NotificationType.APPLICATION_REJECTED,
  ],
  [NotificationFilter.JOBS]: [
    NotificationType.NEW_JOB_MATCH,
    NotificationType.JOB_CLOSING_SOON,
    NotificationType.CANDIDATE_MATCHES,
    NotificationType.RESUME_SENT,
  ],
  [NotificationFilter.PROFILE]: [
    NotificationType.PROFILE_REMINDER,
    NotificationType.PASSPORT_EXPIRY,
    NotificationType.PROFILE_VIEWED,
  ],
  [NotificationFilter.SYSTEM]: [
    NotificationType.EMPLOYER_APPROVED,
    NotificationType.EMPLOYER_REJECTED,
    NotificationType.EMPLOYER_SUSPENDED,
    NotificationType.SUBSCRIPTION_PURCHASED,
    NotificationType.SUBSCRIPTION_EXPIRING,
    NotificationType.SUBSCRIPTION_EXPIRED,
  ],
};

export class ListNotificationsDto {
  @IsOptional()
  @IsEnum(NotificationFilter)
  filter?: NotificationFilter;

  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  unread?: boolean;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Transform(({ value }) => (value !== undefined ? parseInt(value as string, 10) : undefined))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
