import type { components } from '@skillindiaconnect/shared-types';

type CandidateProfile = components['schemas']['CandidateProfile'];
type WorkExperience = components['schemas']['WorkExperience'];
type CandidateSkill = components['schemas']['CandidateSkill'];
type CandidateDocument = components['schemas']['CandidateDocument'];
type ResumeSettings = components['schemas']['ResumeSettings'];
type Company = components['schemas']['Company'];
type Job = components['schemas']['Job'];
type JobCard = components['schemas']['JobCard'];
type JobDetail = components['schemas']['JobDetail'];
type Notification = components['schemas']['Notification'];
type Setting = components['schemas']['Setting'];

// ─── Fixed mock constants ────────────────────────────────────────────────────

export const MOCK_OTP = '123456';
export const NOT_ON_WHATSAPP_PHONE = '+919999999999';
export const NOT_WHATSAPP_CAPABLE_USER_ID = 'mock-user-no-wa';

// ─── In-memory stores ────────────────────────────────────────────────────────

export interface MockUser {
  id: string;
  email: string;
  passwordHash: string;
  role: 'CANDIDATE' | 'EMPLOYER' | 'ADMIN' | 'SUPER_ADMIN';
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

export interface MockCompany extends Company {}

export interface MockJob extends Job {}

export interface MockNotification extends Notification {}

export interface MockSetting extends Setting {}

// ─── Seeded data ─────────────────────────────────────────────────────────────

const NOW = new Date().toISOString();
const PAST_DATE = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

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
    [
      'mock-user-employer-1',
      {
        id: 'mock-user-employer-1',
        email: 'employer@example.com',
        passwordHash: 'hashed-password',
        role: 'EMPLOYER',
        status: 'ACTIVE',
      },
    ],
    [
      'mock-user-admin-1',
      {
        id: 'mock-user-admin-1',
        email: 'admin@example.com',
        passwordHash: 'hashed-password',
        role: 'ADMIN',
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
    ['9876543210', 'mock-user-candidate-1'],
  ]),

  // ── S2: Employer companies ─────────────────────────────────────────────────
  employers: new Map<string, MockCompany>([
    [
      'mock-user-employer-1',
      {
        id: 'mock-company-1',
        name: 'Gulf Builders Arabia',
        type: 'FOREIGN',
        status: 'APPROVED',
        registrationNumber: 'AUH-2024-98765',
        industryType: 'Construction',
        phone: '+971501234567',
        location: 'Abu Dhabi, UAE',
        website: 'https://gulfbuilders.example.com',
        employeeRange: '201-500',
        languagePref: 'en',
        description:
          'Leading construction company operating across the GCC with 20+ years of experience.',
        registrationCertKey: 'employer-docs/mock-company-1/reg-cert.pdf',
        rejectionReason: null,
        createdAt: PAST_DATE,
        approvedAt: PAST_DATE,
      } satisfies MockCompany,
    ],
  ]),

  // ── S2: Job postings ───────────────────────────────────────────────────────
  jobs: new Map<string, MockJob>([
    [
      'job-1',
      {
        id: 'job-1',
        title: 'Experienced Mason',
        status: 'ACTIVE',
        market: 'GULF',
        location: 'Abu Dhabi, UAE',
        description:
          'We are looking for experienced masons for a large construction project in Abu Dhabi. Minimum 3 years of experience required.',
        categoryId: 'cat-construction',
        salaryMin: 1200,
        salaryMax: 1800,
        salaryCurrency: 'AED',
        accommodation: true,
        healthInsurance: true,
        transportation: true,
        workConditions: '8 hours/day, 6 days/week. All PPE provided.',
        requirements: [
          '3+ years masonry experience',
          'Valid passport',
          'Gulf experience preferred',
        ],
        experienceRequiredYears: 3,
        vacancies: 10,
        genderPreference: 'MALE',
        companyId: 'mock-company-1',
        companyName: 'Gulf Builders Arabia',
        createdAt: PAST_DATE,
        publishedAt: PAST_DATE,
        archivedAt: null,
      } satisfies MockJob,
    ],
    [
      'job-2',
      {
        id: 'job-2',
        title: 'Senior Electrician',
        status: 'ACTIVE',
        market: 'LOCAL',
        location: 'Mumbai, Maharashtra',
        description:
          'Certified electrician needed for residential and commercial wiring projects in Mumbai.',
        categoryId: 'cat-electrical',
        salaryMin: 25000,
        salaryMax: 40000,
        salaryCurrency: 'INR',
        accommodation: true,
        healthInsurance: true,
        transportation: true,
        workConditions: 'Monday to Saturday, 9am-6pm.',
        requirements: ['ITI certification in Electrician trade', '2+ years experience'],
        experienceRequiredYears: 2,
        vacancies: 3,
        genderPreference: 'ANY',
        companyId: 'mock-company-1',
        companyName: 'Gulf Builders Arabia',
        createdAt: PAST_DATE,
        publishedAt: PAST_DATE,
        archivedAt: null,
      } satisfies MockJob,
    ],
    [
      'job-3',
      {
        id: 'job-3',
        title: 'Plumber — Gulf Project',
        status: 'ACTIVE',
        market: 'GULF',
        location: 'Dubai, UAE',
        description:
          'Skilled plumbers required for large residential development in Dubai. 2-year contract.',
        categoryId: 'cat-plumbing',
        salaryMin: 1000,
        salaryMax: 1500,
        salaryCurrency: 'AED',
        accommodation: true,
        healthInsurance: true,
        transportation: true,
        workConditions: '10 hours/day, 6 days/week.',
        requirements: ['ITI Plumber trade', 'Gulf experience a plus'],
        experienceRequiredYears: 1,
        vacancies: 5,
        genderPreference: 'ANY',
        companyId: 'mock-company-1',
        companyName: 'Gulf Builders Arabia',
        createdAt: PAST_DATE,
        publishedAt: PAST_DATE,
        archivedAt: null,
      } satisfies MockJob,
    ],
    [
      'job-4',
      {
        id: 'job-4',
        title: 'General Helper',
        status: 'DRAFT',
        market: 'GULF',
        location: 'Riyadh, Saudi Arabia',
        description: 'General helpers needed for a construction site in Riyadh.',
        categoryId: 'cat-general',
        salaryMin: 800,
        salaryMax: 1000,
        salaryCurrency: 'SAR',
        // Missing all three benefits — this job will fail publish with WORKER_PROTECTION_VIOLATION
        accommodation: false,
        healthInsurance: false,
        transportation: false,
        workConditions: 'On-site, shifts may vary.',
        requirements: ['Physical fitness'],
        experienceRequiredYears: 0,
        vacancies: 20,
        genderPreference: 'MALE',
        companyId: 'mock-company-1',
        companyName: 'Gulf Builders Arabia',
        createdAt: NOW,
        publishedAt: null,
        archivedAt: null,
      } satisfies MockJob,
    ],
  ]),

  // ── S2: Saved jobs (candidateId → Set of jobIds) ──────────────────────────
  savedJobs: new Map<string, Set<string>>([['mock-user-candidate-1', new Set(['job-1'])]]),

  // ── S2: Notifications (userId → notifications array) ──────────────────────
  notifications: new Map<string, MockNotification[]>([
    [
      'mock-user-candidate-1',
      [
        {
          id: 'notif-1',
          type: 'APPLICATION_UPDATE',
          title: 'Application Update',
          body: 'Your application for Mason at Gulf Builders Arabia has been shortlisted.',
          read: true,
          readAt: PAST_DATE,
          relatedEntityId: 'job-1',
          relatedEntityType: 'application',
          createdAt: PAST_DATE,
        } satisfies MockNotification,
        {
          id: 'notif-2',
          type: 'JOB_MATCH',
          title: 'New Job Match',
          body: 'A new Gulf job matching your Mason skills is available.',
          read: false,
          readAt: null,
          relatedEntityId: 'job-3',
          relatedEntityType: 'job',
          createdAt: NOW,
        } satisfies MockNotification,
        {
          id: 'notif-3',
          type: 'SYSTEM',
          title: 'Platform Update',
          body: 'New features are available on SkillIndiaConnect. Check out your profile.',
          read: false,
          readAt: null,
          createdAt: NOW,
        } satisfies MockNotification,
      ],
    ],
  ]),

  // ── S2: Platform settings ──────────────────────────────────────────────────
  settings: [
    {
      key: 'REQUIRE_ACCOMMODATION',
      group: 'WORKER_PROTECTION',
      label: 'Require Accommodation',
      description: 'All jobs must offer accommodation to publish.',
      value: true,
      isCoreRule: true,
      updatedAt: null,
      updatedBy: null,
    },
    {
      key: 'REQUIRE_HEALTH_INSURANCE',
      group: 'WORKER_PROTECTION',
      label: 'Require Health Insurance',
      description: 'All jobs must offer health insurance to publish.',
      value: true,
      isCoreRule: true,
      updatedAt: null,
      updatedBy: null,
    },
    {
      key: 'REQUIRE_TRANSPORTATION',
      group: 'WORKER_PROTECTION',
      label: 'Require Transportation',
      description: 'All jobs must offer transportation to publish.',
      value: true,
      isCoreRule: true,
      updatedAt: null,
      updatedBy: null,
    },
    {
      key: 'PROFILE_COMPLETION_THRESHOLD',
      group: 'COMPLETION',
      label: 'Apply Gate Threshold (%)',
      description: 'Minimum profile completion percentage required to apply for a job.',
      value: 70,
      isCoreRule: false,
      updatedAt: null,
      updatedBy: null,
    },
    {
      key: 'FREE_PLAN_JOB_LIMIT',
      group: 'APPLICATION',
      label: 'Free Plan Active Job Limit',
      description: 'Maximum number of active jobs for Free plan employers.',
      value: 1,
      isCoreRule: false,
      updatedAt: null,
      updatedBy: null,
    },
    {
      key: 'PLATFORM_NAME',
      group: 'PLATFORM',
      label: 'Platform Name',
      description: 'Display name used in email templates and WhatsApp messages.',
      value: 'SkillIndiaConnect',
      isCoreRule: false,
      updatedAt: null,
      updatedBy: null,
    },
  ] as MockSetting[],
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

// ─── S2 Job helpers ───────────────────────────────────────────────────────────

export function toJobCard(job: MockJob, savedJobIds: Set<string> | null): JobCard {
  return {
    id: job.id,
    title: job.title,
    market: job.market,
    location: job.location,
    categoryId: job.categoryId ?? null,
    salaryMin: job.salaryMin ?? null,
    salaryMax: job.salaryMax ?? null,
    salaryCurrency: job.salaryCurrency,
    accommodation: job.accommodation,
    healthInsurance: job.healthInsurance,
    transportation: job.transportation,
    companyName: job.companyName,
    createdAt: job.createdAt,
    publishedAt: job.publishedAt ?? null,
    isSaved: savedJobIds !== null ? savedJobIds.has(job.id) : null,
  };
}

export function toJobDetail(
  job: MockJob,
  savedJobIds: Set<string> | null,
  allJobs: Map<string, MockJob>,
): JobDetail {
  const card = toJobCard(job, savedJobIds);
  const similarJobs = [...allJobs.values()]
    .filter(
      (j) =>
        j.id !== job.id &&
        j.status === 'ACTIVE' &&
        (j.market === job.market || j.categoryId === job.categoryId),
    )
    .slice(0, 5)
    .map((j) => toJobCard(j, savedJobIds));

  return {
    ...card,
    description: job.description ?? '',
    requirements: job.requirements ?? [],
    workConditions: job.workConditions ?? '',
    experienceRequiredYears: job.experienceRequiredYears ?? null,
    vacancies: job.vacancies ?? null,
    genderPreference: job.genderPreference ?? 'ANY',
    similarJobs,
  };
}
