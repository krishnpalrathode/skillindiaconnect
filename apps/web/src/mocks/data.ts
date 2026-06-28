import type { components } from '@skillindiaconnect/shared-types';

type CandidateProfile = components['schemas']['CandidateProfile'];
type WorkExperience = components['schemas']['WorkExperience'];
type CandidateSkill = components['schemas']['CandidateSkill'];
type CandidateDocument = components['schemas']['CandidateDocument'];
type ResumeSettings = components['schemas']['ResumeSettings'];

// ─── Fixed mock constants ────────────────────────────────────────────────────

export const MOCK_OTP = '123456';
export const NOT_ON_WHATSAPP_PHONE = '+919999999999';
export const NOT_WHATSAPP_CAPABLE_USER_ID = 'mock-user-no-wa';

// ─── In-memory stores ────────────────────────────────────────────────────────

export interface MockUser {
  id: string;
  email: string;
  passwordHash: string;
  role: 'CANDIDATE' | 'EMPLOYER';
  status: 'ACTIVE' | 'SUSPENDED' | 'PENDING_DELETION';
}

export interface MockCandidate {
  userId: string;
  profile: CandidateProfile;
  resumeSettings: ResumeSettings;
  lastRenderedAt: string | null;
}

export interface MockSession {
  userId: string;
  accessToken: string;
}

export const db = {
  users: new Map<string, MockUser>([
    [
      'mock-user-candidate-1',
      {
        id: 'mock-user-candidate-1',
        email: 'amir@example.com',
        passwordHash: 'hashed-password',
        role: 'CANDIDATE',
        status: 'ACTIVE',
      },
    ],
    [
      NOT_WHATSAPP_CAPABLE_USER_ID,
      {
        id: NOT_WHATSAPP_CAPABLE_USER_ID,
        email: 'nowa@example.com',
        passwordHash: 'hashed-password',
        role: 'CANDIDATE',
        status: 'ACTIVE',
      },
    ],
  ]),

  candidates: new Map<string, MockCandidate>([
    [
      'mock-user-candidate-1',
      {
        userId: 'mock-user-candidate-1',
        profile: buildProfile('mock-user-candidate-1', 'amir@example.com', {
          fullName: 'Amir Khan',
          phone: '+919876543210',
          phoneVerifiedAt: new Date().toISOString(),
          whatsappCapable: true,
          completionPct: 65,
          experiences: [
            {
              id: 'exp-1',
              type: 'FOREIGN',
              country: 'UAE',
              companyName: 'Gulf Construction LLC',
              role: 'Mason',
              years: 3,
              months: 6,
            } satisfies WorkExperience,
          ],
          skills: [
            { id: 'skill-1', name: 'Masonry' } satisfies CandidateSkill,
            { id: 'skill-2', name: 'Plastering' } satisfies CandidateSkill,
          ],
          documents: [
            {
              id: 'doc-1',
              type: 'PASSPORT',
              key: 'uploads/doc-1/passport.pdf',
              status: 'VERIFIED',
              uploadedAt: new Date().toISOString(),
              expiryDate: '2028-06-01',
            } satisfies CandidateDocument,
          ],
        }),
        resumeSettings: {
          language: 'en',
          showPhone: true,
          showReligion: false,
          showFatherName: false,
          showPassportNumber: false,
        },
        lastRenderedAt: null,
      },
    ],
    [
      NOT_WHATSAPP_CAPABLE_USER_ID,
      {
        userId: NOT_WHATSAPP_CAPABLE_USER_ID,
        profile: buildProfile(NOT_WHATSAPP_CAPABLE_USER_ID, 'nowa@example.com', {
          fullName: 'Priya Sharma',
          whatsappCapable: false,
          completionPct: 30,
        }),
        resumeSettings: {
          language: 'en',
          showPhone: false,
          showReligion: false,
          showFatherName: false,
          showPassportNumber: false,
        },
        lastRenderedAt: null,
      },
    ],
  ]),

  sessions: new Map<string, MockSession>(),

  verifiedPhones: new Map<string, string>([
    ['+919876543210', 'mock-user-candidate-1'],
    // Also seed the 10-digit variant (no +91 prefix) so tests that type bare digits work
    ['9876543210', 'mock-user-candidate-1'],
  ]),
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function buildProfile(
  id: string,
  email: string,
  overrides: Partial<CandidateProfile>,
): CandidateProfile {
  return {
    id,
    email,
    role: 'CANDIDATE',
    fullName: '',
    phone: undefined,
    phoneVerifiedAt: null,
    whatsappCapable: null,
    completionPct: 0,
    profileVisible: true,
    isAvailable: true,
    salaryExpectationCurrency: 'INR',
    experiences: [],
    skills: [],
    documents: [],
    status: 'ACTIVE',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

export function makeAccessToken(userId: string): string {
  const user = db.users.get(userId);
  // Produce a decodable JWT-shaped token so auth-context can decode user claims
  // without an extra profile roundtrip. Not cryptographically signed — dev/test only.
  const header = btoa(JSON.stringify({ alg: 'mock', typ: 'JWT' }));
  const payload = btoa(
    JSON.stringify({
      sub: userId,
      email: user?.email ?? '',
      role: user?.role ?? 'CANDIDATE',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 900,
    }),
  );
  return `${header}.${payload}.mock-sig`;
}

export function makeRefreshToken(userId: string): string {
  return `mock-refresh-token-${userId}-${Date.now()}`;
}

export function getUserByToken(token: string): MockUser | undefined {
  const session = db.sessions.get(token);
  if (!session) return undefined;
  return db.users.get(session.userId);
}

export function computeCompletion(profile: CandidateProfile) {
  const sections = [
    {
      key: 'personal',
      label: 'Personal Info',
      complete: !!(profile.fullName && profile.dob && profile.nationality),
      pct: profile.fullName && profile.dob && profile.nationality ? 100 : 40,
    },
    {
      key: 'contact',
      label: 'Contact & Location',
      complete: !!(profile.phone && profile.phoneVerifiedAt && profile.currentLocation),
      pct: profile.phone && profile.phoneVerifiedAt ? 80 : profile.phone ? 40 : 0,
    },
    {
      key: 'experience',
      label: 'Work Experience',
      complete: (profile.experiences?.length ?? 0) > 0,
      pct: Math.min(100, (profile.experiences?.length ?? 0) * 33),
    },
    {
      key: 'skills',
      label: 'Skills',
      complete: (profile.skills?.length ?? 0) >= 1,
      pct: Math.min(100, (profile.skills?.length ?? 0) * 34),
    },
    {
      key: 'documents',
      label: 'Documents',
      complete: (profile.documents ?? []).some(
        (d) => d.type === 'PASSPORT' && d.status === 'VERIFIED',
      ),
      pct: (profile.documents ?? []).some((d) => d.type === 'PASSPORT') ? 60 : 0,
    },
  ];

  const pct = Math.round(sections.reduce((acc, s) => acc + s.pct, 0) / sections.length);

  const hasPassport = (profile.documents ?? []).some(
    (d) => d.type === 'PASSPORT' && d.status === 'VERIFIED',
  );
  const canApply = pct >= 70 && hasPassport;

  const missingForApply: string[] = [];
  if (pct < 70) missingForApply.push('Complete at least 70% of your profile');
  if (!hasPassport) missingForApply.push('Verified passport document required');

  return { pct, sections, canApply, missingForApply };
}
