import type { components } from '@skillindiaconnect/shared-types';

type MaritalStatus = components['schemas']['MaritalStatus'];

/**
 * Human labels for the marital-status enum.
 *
 * ONE map, imported by everything that shows the value. It previously lived as
 * a private const inside PersonalInfoSection, so the profile page rendered
 * "Married" while the resume preview — which had no such map — rendered the raw
 * `MARRIED`. The same candidate saw two different spellings of their own detail
 * on two screens, and the uglier one was on the document they send to
 * employers.
 *
 * English-only, deliberately: it feeds the resume preview, which mirrors the
 * English-only PDF. Screens that are fully localised (onboarding) use the
 * `onboarding.maritalStatus` i18n keys instead — those are translated, this is
 * the document register.
 */
export const MARITAL_STATUS_LABELS: Record<MaritalStatus, string> = {
  SINGLE: 'Single',
  MARRIED: 'Married',
  DIVORCED: 'Divorced',
  WIDOWED: 'Widowed',
};

/**
 * Label for a stored value, tolerant of anything unexpected.
 *
 * Falls back to sentence-casing the raw token rather than returning it
 * untouched, so a value added to the enum before this map is updated still
 * renders as `Separated` rather than `SEPARATED`.
 */
export function maritalStatusLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const known = MARITAL_STATUS_LABELS[value as MaritalStatus];
  if (known) return known;
  const spaced = value.replace(/_/g, ' ').toLowerCase().trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : null;
}
