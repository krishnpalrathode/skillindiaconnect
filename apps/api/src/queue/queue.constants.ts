export const QUEUE_NAMES = {
  ACCOUNT_PURGE: 'account-purge',
  R2_DELETE: 'r2-delete',
  NOTIFICATION: 'notification',
} as const;

export const JOB_NAMES = {
  PURGE_CANDIDATE: 'purge-candidate',
  DELETE_OBJECT: 'delete-object',
  SEND_NOTIFICATION: 'send-notification',
} as const;
