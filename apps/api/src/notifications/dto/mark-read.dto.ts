import { IsArray, IsBoolean, IsOptional, IsString } from 'class-validator';

export class MarkReadDto {
  /** Notification UUIDs to mark as read. Ignored if `all` is true. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  ids?: string[];

  /** If true, marks ALL unread notifications for the current user as read. */
  @IsOptional()
  @IsBoolean()
  all?: boolean;
}
