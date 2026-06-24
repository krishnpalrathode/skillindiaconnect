export const WEIGHTS = {
  personalInfoTotal: 40,
  personalInfoFieldCount: 10,
  personalInfoPerField: 4, // 40 / 10
  experience: 20,
  documents: 30,
  skills: 10,
  skillCap: 3, // max skills that score
} as const;

// Keys correspond 1-to-1 with the 10 SCORED personal-info fields.
// Religion and noticePeriod are intentionally absent (DPDP / CR-001 B1).
export const PERSONAL_INFO_FIELD_KEYS = [
  'photo',
  'fullName',
  'fatherName',
  'dob',
  'verifiedPhone',
  'maritalStatus',
  'languages',
  'jobCategory',
  'currentLocation',
  'nationality',
] as const;

export type PersonalInfoFieldKey = (typeof PERSONAL_INFO_FIELD_KEYS)[number];

export const PERSONAL_INFO_FIELD_LABELS: Record<PersonalInfoFieldKey, string> = {
  photo: 'Profile Photo',
  fullName: 'Full Name',
  fatherName: "Father's Name",
  dob: 'Date of Birth',
  verifiedPhone: 'Verified Phone',
  maritalStatus: 'Marital Status',
  languages: 'Languages',
  jobCategory: 'Job Category',
  currentLocation: 'Current Location',
  nationality: 'Nationality',
};

// MVP mandatory document types — count (N) read from Setting at runtime.
export const MVP_MANDATORY_DOC_COUNT = 3;
export const MVP_MANDATORY_DOC_TYPES = ['PASSPORT', 'EXPERIENCE_CERT', 'EDUCATIONAL_CERT'] as const;

// Applied in completion reporting; enforced at apply time (S4).
export const DEFAULT_MIN_COMPLETION_FOR_APPLY = 60;

// Setting keys
export const SETTING_KEY_MANDATORY_DOC_COUNT = 'candidates.mandatory_documents';
export const SETTING_KEY_MIN_COMPLETION_PCT = 'candidates.min_completion_pct';
