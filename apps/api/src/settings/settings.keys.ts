export const SETTING_KEYS = {
  ACCOMMODATION_REQUIRED: {
    key: 'worker_protection.accommodation_required',
    core: true,
    type: 'boolean' as const,
  },
  HEALTH_INSURANCE_REQUIRED: {
    key: 'worker_protection.health_insurance_required',
    core: true,
    type: 'boolean' as const,
  },
  TRANSPORTATION_REQUIRED: {
    key: 'worker_protection.transportation_required',
    core: true,
    type: 'boolean' as const,
  },
  AUTO_ARCHIVE_DAYS: {
    key: 'jobs.auto_archive_days',
    core: false,
    type: 'number' as const,
  },
  REQUIRE_ADMIN_APPROVAL: {
    key: 'jobs.require_admin_approval',
    core: false,
    type: 'boolean' as const,
  },
  FREE_MAX_ACTIVE_JOBS: {
    key: 'jobs.free_max_active_jobs',
    core: false,
    type: 'number' as const,
  },
  ALLOW_LOCAL_JOBS: {
    key: 'jobs.allow_local',
    core: false,
    type: 'boolean' as const,
  },
  ALLOW_FOREIGN_JOBS: {
    key: 'jobs.allow_foreign',
    core: false,
    type: 'boolean' as const,
  },
  MANDATORY_DOCUMENTS: {
    key: 'candidates.mandatory_documents',
    core: false,
    type: 'string[]' as const,
  },
  MIN_COMPLETION_PCT: {
    key: 'candidates.min_completion_pct',
    core: false,
    type: 'number' as const,
  },
  VIDEO_MAX_MINUTES: {
    key: 'candidates.video_max_minutes',
    core: false,
    type: 'number' as const,
  },
  VIDEO_MAX_MB: {
    key: 'candidates.video_max_mb',
    core: false,
    type: 'number' as const,
  },
} as const;

export type SettingType = 'boolean' | 'number' | 'string[]';

export type AnyKeyDef = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

// Typed return: get(SETTING_KEYS.MIN_COMPLETION_PCT) → number, etc.
export type TypedValue<D extends AnyKeyDef> = D['type'] extends 'boolean'
  ? boolean
  : D['type'] extends 'number'
    ? number
    : D['type'] extends 'string[]'
      ? string[]
      : never;

export function isValidValue(type: SettingType, value: unknown): boolean {
  switch (type) {
    case 'boolean':
      return typeof value === 'boolean';
    case 'number':
      return typeof value === 'number' && isFinite(value);
    case 'string[]':
      return Array.isArray(value) && (value as unknown[]).every((v) => typeof v === 'string');
  }
}
