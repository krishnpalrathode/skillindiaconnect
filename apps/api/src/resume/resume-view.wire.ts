import { ResumeRenderSettings, ResumeViewDto } from './resume-view.mapper';

/**
 * S7-B2 — the two shapes on either side of the stored generation row.
 *
 * WHY a stored snapshot at all: the contract says `ResumeGeneration.view` IS
 * the field set the PDF was rendered from. Rebuilding it from the LIVE profile
 * at poll time would drift from the stored bytes the instant the candidate
 * edits anything — the preview would show a resume that does not exist. So the
 * worker persists exactly what it rendered, and this module serves that.
 *
 * The only substitution is the photo: the render view inlines it as a data URI
 * (kilobytes of base64, useless to a client and wasteful in a JSON column), so
 * the stored row keeps the R2 KEY and the API mints a short-expiry signed url
 * per read — the same discipline as every other document url in the product.
 */
export type StoredResumeView = Omit<ResumeViewDto, 'photoDataUri'> & {
  photoKey: string | null;
};

/** The S7-0 `ResumeView` as it goes over the wire. */
export interface WireResumeView {
  fullName: string;
  photoUrl: string | null;
  email: string;
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
  experiences: StoredResumeView['experiences'];
  skills: StoredResumeView['skills'];
  documents: StoredResumeView['documents'];
  generatedAt: string;
  settingsApplied: ResumeRenderSettings;
}

/** Render view → the row we store (data URI out, key in). */
export function toStoredResumeView(
  view: ResumeViewDto,
  photoKey: string | null,
): StoredResumeView {
  const rest = { ...view } as Partial<ResumeViewDto>;
  delete rest.photoDataUri;
  return { ...(rest as Omit<ResumeViewDto, 'photoDataUri'>), photoKey };
}

/**
 * Stored row → wire. `hasVideo` and `photoKey` are render-side details and do
 * NOT cross the wire. Omitted fields stay omitted: this only ever COPIES what
 * the snapshot holds, so a field the mapper withheld at generation time cannot
 * reappear here.
 */
export function toWireResumeView(
  stored: StoredResumeView,
  photoUrl: string | null,
): WireResumeView {
  const wire: WireResumeView = {
    fullName: stored.fullName,
    photoUrl,
    email: stored.email,
    dob: stored.dob,
    maritalStatus: stored.maritalStatus,
    nationality: stored.nationality,
    currentLocation: stored.currentLocation,
    languages: stored.languages,
    jobCategory: stored.jobCategory,
    experiences: stored.experiences,
    skills: stored.skills,
    documents: stored.documents,
    generatedAt: stored.generatedAt,
    settingsApplied: stored.settingsApplied,
  };
  if (stored.phone !== undefined) wire.phone = stored.phone;
  if (stored.fatherName !== undefined) wire.fatherName = stored.fatherName;
  if (stored.religion !== undefined) wire.religion = stored.religion;
  if (stored.passportNumber !== undefined) wire.passportNumber = stored.passportNumber;
  return wire;
}
