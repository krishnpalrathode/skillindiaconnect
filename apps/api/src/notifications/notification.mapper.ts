import { Notification, NotificationType } from '@prisma/client';

/**
 * Public candidate-facing notification shape (contract `Notification`).
 * Derives `read` from `readAt`, surfaces the related-entity link from the `data`
 * jsonb, and DROPS internal columns (`userId`, raw `data`).
 */
export interface NotificationDto {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  read: boolean;
  readAt: string | null;
  relatedEntityId?: string;
  relatedEntityType?: 'job' | 'application';
  createdAt: string;
}

export function toNotificationDto(row: Notification): NotificationDto {
  const data = (row.data ?? {}) as Record<string, unknown>;
  const relatedEntityId =
    typeof data['relatedEntityId'] === 'string' ? (data['relatedEntityId'] as string) : undefined;
  const relatedEntityTypeRaw = data['relatedEntityType'];
  const relatedEntityType =
    relatedEntityTypeRaw === 'job' || relatedEntityTypeRaw === 'application'
      ? relatedEntityTypeRaw
      : undefined;

  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    read: row.readAt !== null,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    ...(relatedEntityId ? { relatedEntityId } : {}),
    ...(relatedEntityType ? { relatedEntityType } : {}),
    createdAt: row.createdAt.toISOString(),
  };
}
