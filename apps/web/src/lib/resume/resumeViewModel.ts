import type { components } from '@skillindiaconnect/shared-types';

type CandidateProfile = components['schemas']['CandidateProfile'];
type ResumeSettings = components['schemas']['ResumeSettings'];
type WorkExperience = components['schemas']['WorkExperience'];
type CandidateSkill = components['schemas']['CandidateSkill'];
type DocumentType = components['schemas']['DocumentType'];

/**
 * The candidate's raw passport number is NOT part of the self-profile payload
 * (it lives on the encrypted document, surfaced only in the server's
 * `pdf-renderer` context). The browser preview therefore cannot show the real
 * digits — it shows this honest placeholder so the candidate knows the number
 * WILL be printed on the PDF when the toggle is on, without fabricating a value.
 */
export const PASSPORT_NUMBER_PLACEHOLDER = 'Shown on your PDF';

/** A status-only document summary — mirrors the server's `CandidateDocumentStatus`. */
export interface PreviewDocument {
  type: DocumentType;
  uploaded: boolean;
  /** PASSPORT only: true when a passport exists and is not expired. */
  passportValid?: boolean;
}

/**
 * The exact field set the PREVIEW renders — a browser-side mirror of the
 * server's `ResumeView` (what the PDF bytes will contain). Toggle-governed
 * fields are ABSENT (not null/empty) when their setting is off, identical to
 * the server's omission-in-the-bytes discipline.
 */
export interface ResumePreviewModel {
  fullName: string;
  email: string;
  /** ABSENT when `showPhone` is off. */
  phone?: string;
  /** ABSENT when `showFatherName` is off. */
  fatherName?: string;
  /** ABSENT when `showReligion` is off (default off). */
  religion?: string;
  /** ABSENT when `showPassportNumber` is off (default off) or no passport on file. */
  passportNumber?: string;
  /**
   * The candidate's own intro, shown at the TOP. Not toggle-governed — they
   * wrote it for the resume, so writing it IS the opt-in. Null when empty, and
   * the preview omits the block entirely rather than leaving a gap, matching
   * what every PDF template does with it.
   */
  summary?: string | null;
  dob?: string | null;
  maritalStatus?: string | null;
  nationality?: string | null;
  currentLocation?: string | null;
  languages: string[];
  experiences: WorkExperience[];
  skills: CandidateSkill[];
  documents: PreviewDocument[];
  settingsApplied: ResumeSettings;
}

/**
 * Build the preview's field set from the profile + the CURRENT Resume Settings.
 *
 * This deliberately mirrors the server's `buildResumeView` omission rules so the
 * on-screen preview and the eventual PDF agree on WHICH fields appear:
 *   - `showPhone: false`          → `phone` absent
 *   - `showFatherName: false`     → `fatherName` absent
 *   - `showReligion: false`       → `religion` absent (default off)
 *   - `showPassportNumber: false` → `passportNumber` absent (default off)
 *
 * Everything else renders unconditionally when the profile actually has it —
 * a sparse profile yields a sparse preview (no fabricated content).
 *
 * NB: this reflects the settings passed in RIGHT NOW (live), which is NOT
 * necessarily what an already-generated PDF contains — that PDF is a snapshot.
 * The hub's copy tells the candidate to "regenerate to apply" a settings change.
 */
export function buildResumePreview(
  profile: CandidateProfile,
  settings: ResumeSettings,
): ResumePreviewModel {
  const documents: PreviewDocument[] = (profile.documents ?? []).map((d) => ({
    type: d.type,
    uploaded: true,
    ...(d.type === 'PASSPORT'
      ? { passportValid: d.expiryDate ? new Date(d.expiryDate) > new Date() : false }
      : {}),
  }));

  const model: ResumePreviewModel = {
    fullName: profile.fullName ?? '',
    email: profile.email ?? '',
    summary: profile.summary?.trim() || null,
    dob: profile.dob ?? null,
    maritalStatus: profile.maritalStatus ?? null,
    nationality: profile.nationality ?? null,
    currentLocation: profile.currentLocation ?? null,
    languages: profile.languages ?? [],
    experiences: profile.experiences ?? [],
    skills: profile.skills ?? [],
    documents,
    settingsApplied: settings,
  };

  if (settings.showPhone && profile.phone) model.phone = profile.phone;
  if (settings.showFatherName && profile.fatherName) model.fatherName = profile.fatherName;
  if (settings.showReligion && profile.religion) model.religion = profile.religion;

  const hasPassport = documents.some((d) => d.type === 'PASSPORT');
  if (settings.showPassportNumber && hasPassport) {
    model.passportNumber = PASSPORT_NUMBER_PLACEHOLDER;
  }

  return model;
}
