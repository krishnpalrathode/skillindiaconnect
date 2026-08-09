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
  /**
   * Completion % at which a candidate is sent their top matching jobs.
   *
   * DELIBERATELY SEPARATE from MIN_COMPLETION_PCT (the apply gate): the two
   * answer different questions — "is this profile good enough to apply with"
   * vs "is it complete enough to be worth matching". Sharing one number would
   * mean raising the apply bar silently changed who gets alerted.
   */
  MATCH_ALERT_MIN_PCT: {
    key: 'candidates.match_alert_min_pct',
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
  // S5-B1: Payments — GST rate used by the checkout money split (LOCAL
  // companies), and the Stripe routing flag for FOREIGN companies.
  GST_RATE_PCT: {
    key: 'payments.gst_rate_pct',
    core: false,
    type: 'number' as const,
  },
  STRIPE_ENABLED: {
    key: 'payments.stripe_enabled',
    core: false,
    type: 'boolean' as const,
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

/**
 * Optional numeric bounds, checked in ADDITION to the type.
 *
 * Type-checking alone let an admin save `jobs.free_max_active_jobs = 0` or `-1`
 * — a value the API accepted happily and which then blocked EVERY Free employer
 * from publishing anything, platform-wide, from one typo on a settings screen.
 * A quota of "at least one" is a real business rule, so it is enforced at the
 * boundary rather than trusted to the person typing.
 *
 * Only keys that have a meaningful floor/ceiling appear here; anything absent is
 * type-checked exactly as before.
 */
export const NUMBER_BOUNDS: Record<string, { min?: number; max?: number }> = {
  'jobs.free_max_active_jobs': { min: 1, max: 1000 },
  'jobs.auto_archive_days': { min: 1, max: 3650 },
  'candidates.min_completion_pct': { min: 0, max: 100 },
  'candidates.match_alert_min_pct': { min: 0, max: 100 },
  'candidates.video_max_minutes': { min: 1, max: 120 },
  'candidates.video_max_mb': { min: 1, max: 5000 },
  'payments.gst_rate_pct': { min: 0, max: 100 },
};

/** Range check for a numeric setting. Non-numeric keys always pass. */
export function isWithinBounds(key: string, value: unknown): boolean {
  const bounds = NUMBER_BOUNDS[key];
  if (!bounds || typeof value !== 'number') return true;
  if (bounds.min !== undefined && value < bounds.min) return false;
  if (bounds.max !== undefined && value > bounds.max) return false;
  return true;
}

/** Human-readable range, for the 422 detail. */
export function describeBounds(key: string): string {
  const b = NUMBER_BOUNDS[key];
  if (!b) return '';
  if (b.min !== undefined && b.max !== undefined) return `between ${b.min} and ${b.max}`;
  if (b.min !== undefined) return `at least ${b.min}`;
  return `at most ${b.max}`;
}
