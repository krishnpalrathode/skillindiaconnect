import { ResumeTemplate } from '@prisma/client';
import { ResumeSource } from '../candidate/candidate-read.service';

/**
 * Resume settings as they drive rendering (the CandidateResume columns /
 * the S7-0 `ResumeSettings` schema).
 *
 * `template` (CR-001 B1) is the odd one out: every other field here decides
 * WHAT the PDF contains, and is applied by the mapper below. `template` decides
 * how it LOOKS and is applied by the registry AFTER the mapper has already run.
 * It rides in this interface because it is a resume setting with the same
 * apply-at-generation semantics — not because the mapper consults it. It does
 * not, and must not.
 */
export interface ResumeRenderSettings {
  language: string;
  showPhone: boolean;
  showReligion: boolean;
  showFatherName: boolean;
  showPassportNumber: boolean;
  template: ResumeTemplate;
}

/** The S7-0 `ResumeView` — exactly the field set the PDF renders. */
export interface ResumeViewDto {
  fullName: string;
  email: string;
  photoDataUri: string | null;
  phone?: string;
  fatherName?: string;
  religion?: string;
  passportNumber?: string;
  dob: string | null;
  maritalStatus: string | null;
  nationality: string | null;
  currentLocation: string | null;
  languages: string[];
  jobCategory: string | null;
  experiences: {
    id: string;
    type: string;
    country: string;
    companyName: string;
    role: string;
    years: number;
    months: number;
    startDate: string | null;
    endDate: string | null;
  }[];
  skills: { id: string; name: string }[];
  documents: { type: string; uploaded: boolean; passportValid?: boolean }[];
  /** Data URI when a working video exists — Phase 2; null at MVP. */
  hasVideo: boolean;
  generatedAt: string;
  settingsApplied: ResumeRenderSettings;
}

export const RESUME_SETTINGS_DEFAULTS: ResumeRenderSettings = {
  language: 'en',
  showPhone: true,
  showReligion: false,
  // Confirmed against the S1 data design (candidate_resumes default) at the
  // S7-0 freeze: father's name shows by default.
  showFatherName: true,
  showPassportNumber: false,
  template: ResumeTemplate.CLASSIC,
};

/**
 * THE THIRD VIEWER CONTEXT (S7-0 / S7-B1) — the omission chokepoint.
 *
 * Omissions are driven by RESUME SETTINGS, never the profile privacy toggles
 * (do NOT reuse the employer-context mapper's rules). An omitted field is
 * simply NOT ON the returned object — it never reaches the template, never
 * reaches Chromium, never reaches the PDF bytes. The byte-level tests extract
 * text from the rendered PDF and assert absence.
 *
 * `passportNumber` MAY appear here when the candidate turns it on — their own
 * document, their own choice — even though the employer context never carries
 * it. Distinct contexts, distinct rules; this is not a privacy regression.
 *
 * ⚠️ CODEOWNERS second review: this mapper is a new privacy surface.
 */
export function toResumeView(
  source: ResumeSource,
  settings: ResumeRenderSettings,
  photoDataUri: string | null,
  now: Date = new Date(),
): ResumeViewDto {
  const passport = source.documents.find((d) => d.type === 'PASSPORT');

  const view: ResumeViewDto = {
    fullName: source.fullName,
    email: source.user.email,
    photoDataUri,
    dob: source.dob ? source.dob.toISOString().slice(0, 10) : null,
    maritalStatus: source.maritalStatus,
    nationality: source.nationality,
    currentLocation: source.currentLocation,
    languages: source.languages,
    jobCategory: source.jobCategory?.nameEn ?? null,
    experiences: source.experiences.map((e) => ({
      id: e.id,
      type: e.type,
      country: e.country,
      companyName: e.companyName,
      role: e.role,
      years: e.years,
      months: e.months,
      startDate: e.startDate ? e.startDate.toISOString().slice(0, 10) : null,
      endDate: e.endDate ? e.endDate.toISOString().slice(0, 10) : null,
    })),
    skills: source.skills.map((s) => ({ id: s.id, name: s.name })),
    documents: source.documents.map((d) => ({
      type: d.type,
      // Every row in this list IS an upload — the resume never lists a document
      // the candidate hasn't provided. The flag exists for the wire shape.
      uploaded: true,
      ...(d.type === 'PASSPORT'
        ? { passportValid: d.expiryDate ? d.expiryDate > now : false }
        : {}),
    })),
    // The Video Portfolio section exists ONLY when a video exists (B6/Phase 2)
    // — absent at MVP, never an empty placeholder.
    hasVideo: source.videoR2Key !== null,
    generatedAt: now.toISOString(),
    settingsApplied: { ...settings },
  };

  // The four toggles — omission means ABSENT FROM THE OBJECT, nothing less.
  if (settings.showPhone && source.phone) view.phone = source.phone;
  if (settings.showFatherName && source.fatherName) view.fatherName = source.fatherName;
  if (settings.showReligion && source.religion) view.religion = source.religion;
  if (settings.showPassportNumber && passport?.documentNumber) {
    view.passportNumber = passport.documentNumber;
  }

  return view;
}
