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

// Employer fixture user IDs (seeded into db.users + db.employers above)
export const EMPLOYER_APPROVED_USER_ID = 'mock-user-employer-1';
export const EMPLOYER_APPROVED_EMAIL = 'employer@example.com';
export const EMPLOYER_PENDING_USER_ID = 'mock-user-employer-pending';
export const EMPLOYER_PENDING_EMAIL = 'employer-pending@example.com';
export const EMPLOYER_REJECTED_USER_ID = 'mock-user-employer-rejected';
export const EMPLOYER_REJECTED_EMAIL = 'employer-rejected@example.com';
export const EMPLOYER_SUSPENDED_USER_ID = 'mock-user-employer-suspended';
export const EMPLOYER_SUSPENDED_EMAIL = 'employer-suspended@example.com';

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

// ─── S3: New mock interfaces ──────────────────────────────────────────────────

export interface MockHiringPreferences {
  preferredCategories: string[];
  preferredNationalities: string[];
  minExperience: number;
  notes: string;
}

export interface MockContactPerson {
  id: string;
  name: string;
  role: string;
  phone?: string;
  email?: string;
  isPrimary: boolean;
  createdAt: string;
}

export interface MockProfileViewRecord {
  companyId: string;
  companyName: string;
  candidateId: string;
  viewedAt: string;
}

// ─── Seeded data ─────────────────────────────────────────────────────────────

const NOW = new Date().toISOString();
const PAST_DATE = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

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
    [
      'mock-user-employer-pending',
      {
        id: 'mock-user-employer-pending',
        email: 'employer-pending@example.com',
        passwordHash: 'hashed-password',
        role: 'EMPLOYER',
        status: 'ACTIVE',
      },
    ],
    [
      'mock-user-employer-rejected',
      {
        id: 'mock-user-employer-rejected',
        email: 'employer-rejected@example.com',
        passwordHash: 'hashed-password',
        role: 'EMPLOYER',
        status: 'ACTIVE',
      },
    ],
    [
      'mock-user-employer-suspended',
      {
        id: 'mock-user-employer-suspended',
        email: 'employer-suspended@example.com',
        passwordHash: 'hashed-password',
        role: 'EMPLOYER',
        status: 'SUSPENDED',
      },
    ],
    // S3: Additional browsable candidate users
    [
      'mock-user-candidate-2',
      {
        id: 'mock-user-candidate-2',
        email: 'rajan@example.com',
        passwordHash: 'hashed-password',
        role: 'CANDIDATE',
        status: 'ACTIVE',
      },
    ],
    [
      'mock-user-candidate-hidden',
      {
        id: 'mock-user-candidate-hidden',
        email: 'hidden@example.com',
        passwordHash: 'hashed-password',
        role: 'CANDIDATE',
        status: 'ACTIVE',
      },
    ],
  ]),

  // S3 browsable candidate user IDs
  // mock-user-candidate-1 = Amir Khan (profileVisible=true, showPhone=true)
  // NOT_WHATSAPP_CAPABLE_USER_ID = Priya Sharma (profileVisible=true, showPhone=false)
  // mock-user-candidate-2 = Rajan Patel (profileVisible=true, showReligion=false default)
  // mock-user-candidate-hidden = Hidden User (profileVisible=false — NEVER in browse)

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
          profileVisible: true,
          // showPhone toggle is in resumeSettings.showPhone = false (below)
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
    // S3: Rajan Patel — fully visible, showPhone=true, showReligion=false (default)
    [
      'mock-user-candidate-2',
      {
        userId: 'mock-user-candidate-2',
        profile: buildProfile('mock-user-candidate-2', 'rajan@example.com', {
          fullName: 'Rajan Patel',
          phone: '+919988112233',
          phoneVerifiedAt: daysAgo(30),
          whatsappCapable: true,
          completionPct: 80,
          nationality: 'Indian',
          currentLocation: 'Surat, Gujarat',
          jobCategoryId: 'cat-construction',
          isAvailable: true,
          noticePeriod: 30,
          languages: ['Hindi', 'Gujarati', 'English'],
          experiences: [
            {
              id: 'exp-rajan-1',
              type: 'INDIA',
              country: 'India',
              companyName: 'Patel Construction',
              role: 'Carpenter',
              years: 5,
              months: 0,
            } satisfies WorkExperience,
          ],
          skills: [
            { id: 'skill-rajan-1', name: 'Carpentry' } satisfies CandidateSkill,
            { id: 'skill-rajan-2', name: 'Woodwork' } satisfies CandidateSkill,
          ],
          documents: [
            {
              id: 'doc-rajan-1',
              type: 'PASSPORT',
              key: 'uploads/doc-rajan-1/passport.pdf',
              status: 'VERIFIED',
              uploadedAt: daysAgo(60),
              expiryDate: '2029-03-15',
            } satisfies CandidateDocument,
          ],
          profileVisible: true,
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
    // S3: Hidden candidate — profileVisible=false, NEVER appears in browse or employer view
    [
      'mock-user-candidate-hidden',
      {
        userId: 'mock-user-candidate-hidden',
        profile: buildProfile('mock-user-candidate-hidden', 'hidden@example.com', {
          fullName: 'Hidden User',
          completionPct: 50,
          profileVisible: false,
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
  ]),

  // S3: Additional candidate users (also add to db.users below)
  // These are seeded inline — no separate db.users entries needed here;
  // they're referenced from the candidates map above via userId.

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
    [
      'mock-user-employer-pending',
      {
        id: 'mock-company-pending',
        name: 'New Horizons Staffing',
        type: 'LOCAL',
        status: 'PENDING',
        registrationNumber: 'MH-2025-11111',
        industryType: 'Staffing',
        phone: '+919988776655',
        location: 'Mumbai, India',
        employeeRange: '11-50',
        languagePref: 'en',
        description: 'A new staffing agency pending admin review.',
        registrationCertKey: null,
        rejectionReason: null,
        createdAt: NOW,
        approvedAt: null,
      } satisfies MockCompany,
    ],
    [
      'mock-user-employer-rejected',
      {
        id: 'mock-company-rejected',
        name: 'Apex Manpower Solutions',
        type: 'LOCAL',
        status: 'REJECTED',
        registrationNumber: 'DL-2024-22222',
        industryType: 'Manpower',
        phone: '+919876500000',
        location: 'Delhi, India',
        employeeRange: '51-200',
        languagePref: 'en',
        description: 'Company registration was rejected.',
        registrationCertKey: null,
        rejectionReason:
          'Registration certificate could not be verified. Please resubmit with a valid certificate.',
        createdAt: PAST_DATE,
        approvedAt: null,
      } satisfies MockCompany,
    ],
    [
      'mock-user-employer-suspended',
      {
        id: 'mock-company-suspended',
        name: 'Blacklisted Corp',
        type: 'FOREIGN',
        status: 'SUSPENDED',
        registrationNumber: 'INT-2023-33333',
        industryType: 'Construction',
        phone: '+971509876543',
        location: 'Dubai, UAE',
        employeeRange: '201-500',
        languagePref: 'en',
        description: 'Company account is suspended.',
        registrationCertKey: 'employer-docs/suspended-company/reg-cert.pdf',
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
    [
      'job-5',
      {
        id: 'job-5',
        title: 'Housekeeping Supervisor',
        status: 'ACTIVE',
        market: 'GULF',
        location: 'Doha, Qatar',
        description:
          'Hotel housekeeping supervisor for a 5-star property in Doha. Lead a team of 12 room attendants.',
        categoryId: 'cat-housekeeping',
        salaryMin: 1500,
        salaryMax: 2200,
        salaryCurrency: 'QAR',
        accommodation: true,
        healthInsurance: true,
        transportation: true,
        workConditions: '6 days/week, rotating shifts.',
        requirements: ['3+ years hotel housekeeping experience', 'Team supervision experience'],
        experienceRequiredYears: 3,
        vacancies: 2,
        genderPreference: 'ANY',
        companyId: 'mock-company-1',
        companyName: 'Gulf Builders Arabia',
        createdAt: daysAgo(1),
        publishedAt: daysAgo(1),
        archivedAt: null,
      } satisfies MockJob,
    ],
    [
      'job-6',
      {
        id: 'job-6',
        title: 'Delivery Driver',
        status: 'ACTIVE',
        market: 'LOCAL',
        location: 'Bengaluru, Karnataka',
        description: 'Two-wheeler delivery riders needed for last-mile logistics across Bengaluru.',
        categoryId: 'cat-driving',
        salaryMin: 18000,
        salaryMax: 28000,
        salaryCurrency: 'INR',
        accommodation: false,
        healthInsurance: true,
        transportation: false,
        workConditions: 'Flexible shifts, own two-wheeler required.',
        requirements: ['Valid driving license', 'Smartphone'],
        experienceRequiredYears: 0,
        vacancies: 25,
        genderPreference: 'ANY',
        companyId: 'mock-company-1',
        companyName: 'Gulf Builders Arabia',
        createdAt: daysAgo(2),
        publishedAt: daysAgo(2),
        archivedAt: null,
      } satisfies MockJob,
    ],
    [
      'job-7',
      {
        id: 'job-7',
        title: 'Hospitality Steward',
        status: 'ACTIVE',
        market: 'GULF',
        location: 'Manama, Bahrain',
        description: 'Banquet and restaurant stewards needed for a luxury resort in Manama.',
        categoryId: 'cat-hospitality',
        salaryMin: 900,
        salaryMax: 1300,
        salaryCurrency: 'BHD',
        accommodation: true,
        healthInsurance: true,
        transportation: true,
        workConditions: '9 hours/day, 6 days/week, meals included.',
        requirements: ['1+ years hospitality experience', 'Basic English'],
        experienceRequiredYears: 1,
        vacancies: 8,
        genderPreference: 'ANY',
        companyId: 'mock-company-1',
        companyName: 'Gulf Builders Arabia',
        createdAt: daysAgo(3),
        publishedAt: daysAgo(3),
        archivedAt: null,
      } satisfies MockJob,
    ],
    [
      'job-8',
      {
        id: 'job-8',
        title: 'Security Guard',
        status: 'ACTIVE',
        market: 'LOCAL',
        location: 'Pune, Maharashtra',
        description:
          'Licensed security guards for a corporate campus in Pune. Day and night shifts available.',
        categoryId: 'cat-security',
        salaryMin: 16000,
        salaryMax: 22000,
        salaryCurrency: 'INR',
        accommodation: false,
        healthInsurance: false,
        transportation: true,
        workConditions: '12-hour shifts, 6 days/week.',
        requirements: ['PSARA license', 'Physically fit'],
        experienceRequiredYears: 1,
        vacancies: 6,
        genderPreference: 'ANY',
        companyId: 'mock-company-1',
        companyName: 'Gulf Builders Arabia',
        createdAt: daysAgo(4),
        publishedAt: daysAgo(4),
        archivedAt: null,
      } satisfies MockJob,
    ],
    [
      'job-9',
      {
        id: 'job-9',
        title: 'Certified Welder',
        status: 'ACTIVE',
        market: 'GULF',
        location: 'Jeddah, Saudi Arabia',
        description: 'AWS-certified welders for a petrochemical fabrication yard in Jeddah.',
        categoryId: 'cat-welding',
        salaryMin: 2000,
        salaryMax: 2800,
        salaryCurrency: 'SAR',
        accommodation: true,
        healthInsurance: true,
        transportation: true,
        workConditions:
          '10 hours/day, 6 days/week. Full PPE and welding certification test on arrival.',
        requirements: [
          'AWS or equivalent welding certification',
          '4+ years industrial welding experience',
        ],
        experienceRequiredYears: 4,
        vacancies: 4,
        genderPreference: 'MALE',
        companyId: 'mock-company-1',
        companyName: 'Gulf Builders Arabia',
        createdAt: daysAgo(5),
        publishedAt: daysAgo(5),
        archivedAt: null,
      } satisfies MockJob,
    ],
    [
      'job-10',
      {
        id: 'job-10',
        title: 'Junior Electrician',
        status: 'ACTIVE',
        market: 'LOCAL',
        location: 'Ahmedabad, Gujarat',
        description: 'Entry-level electrician role for industrial maintenance work in Ahmedabad.',
        categoryId: 'cat-electrical',
        salaryMin: 14000,
        salaryMax: 20000,
        salaryCurrency: 'INR',
        accommodation: false,
        healthInsurance: true,
        transportation: false,
        workConditions: 'Monday to Saturday, 9am-6pm.',
        requirements: ['ITI certification in Electrician trade'],
        experienceRequiredYears: 0,
        vacancies: 5,
        genderPreference: 'ANY',
        companyId: 'mock-company-1',
        companyName: 'Gulf Builders Arabia',
        createdAt: daysAgo(6),
        publishedAt: daysAgo(6),
        archivedAt: null,
      } satisfies MockJob,
    ],
    [
      'job-11',
      {
        id: 'job-11',
        title: 'Construction Site Foreman',
        status: 'ACTIVE',
        market: 'GULF',
        location: 'Abu Dhabi, UAE',
        description:
          'Experienced foreman to supervise a 40-person construction crew on a tower project.',
        categoryId: 'cat-construction',
        salaryMin: 2500,
        salaryMax: 3500,
        salaryCurrency: 'AED',
        accommodation: true,
        healthInsurance: true,
        transportation: true,
        workConditions: '8 hours/day, 6 days/week. Site accommodation provided.',
        requirements: ['5+ years construction supervision', 'Gulf experience required'],
        experienceRequiredYears: 5,
        vacancies: 1,
        genderPreference: 'MALE',
        companyId: 'mock-company-1',
        companyName: 'Gulf Builders Arabia',
        createdAt: daysAgo(8),
        publishedAt: daysAgo(8),
        archivedAt: null,
      } satisfies MockJob,
    ],
    [
      'job-12',
      {
        id: 'job-12',
        title: 'General Labourer — Local Sites',
        status: 'ACTIVE',
        market: 'LOCAL',
        location: 'Chennai, Tamil Nadu',
        description: 'General labourers for residential building sites across Chennai.',
        categoryId: 'cat-general',
        salaryMin: 12000,
        salaryMax: 16000,
        salaryCurrency: 'INR',
        accommodation: false,
        healthInsurance: false,
        transportation: false,
        workConditions: 'Day shift, 6 days/week.',
        requirements: ['Physical fitness'],
        experienceRequiredYears: 0,
        vacancies: 15,
        genderPreference: 'ANY',
        companyId: 'mock-company-1',
        companyName: 'Gulf Builders Arabia',
        createdAt: daysAgo(9),
        publishedAt: daysAgo(9),
        archivedAt: null,
      } satisfies MockJob,
    ],
  ]),

  // ── S3: Hiring preferences (userId → preferences) ─────────────────────────
  hiringPreferences: new Map<string, MockHiringPreferences>([
    [
      'mock-user-employer-1',
      {
        preferredCategories: ['cat-construction', 'cat-electrical'],
        preferredNationalities: ['Indian', 'Nepali'],
        minExperience: 2,
        notes: 'Prefer candidates with Gulf experience and valid passport.',
      },
    ],
  ]),

  // ── S3: Contact persons (userId → contacts array) ─────────────────────────
  contactPersons: new Map<string, MockContactPerson[]>([
    [
      'mock-user-employer-1',
      [
        {
          id: 'contact-1',
          name: 'Rajesh Mehta',
          role: 'HR Manager',
          phone: '+971501234567',
          email: 'rajesh@gulfbuilders.example.com',
          isPrimary: true,
          createdAt: PAST_DATE,
        },
        {
          id: 'contact-2',
          name: 'Fatima Al-Zahra',
          role: 'Recruitment Lead',
          phone: '+971509876543',
          email: 'fatima@gulfbuilders.example.com',
          isPrimary: false,
          createdAt: PAST_DATE,
        },
      ],
    ],
  ]),

  // ── S3: Company logos (userId → R2 logoKey) ────────────────────────────────
  companyLogos: new Map<string, string>([
    ['mock-user-employer-1', 'employer-logos/mock-company-1/logo.jpg'],
  ]),

  // ── S3: Profile views (array of view records for dedup + analytics) ────────
  // Dedup key: companyId + ':' + candidateId → last viewed ISO string
  profileViewDedup: new Map<string, string>([
    // Pre-seeded view: Gulf Builders Arabia viewed Amir Khan 2 days ago
    [`mock-company-1:mock-user-candidate-1`, daysAgo(2)],
  ]),

  // Full view records for analytics (newest first)
  profileViews: [
    {
      companyId: 'mock-company-1',
      companyName: 'Gulf Builders Arabia',
      candidateId: 'mock-user-candidate-1',
      viewedAt: daysAgo(2),
    },
  ] as MockProfileViewRecord[],

  // ── S2: Saved jobs (candidateId → Set of jobIds) ──────────────────────────
  savedJobs: new Map<string, Set<string>>([['mock-user-candidate-1', new Set(['job-1'])]]),

  // ── S2: Notifications (userId → notifications array) ──────────────────────
  notifications: new Map<string, MockNotification[]>([
    [
      'mock-user-candidate-1',
      [
        // S3-F3: profile-visibility events (server-rendered title/body).
        {
          id: 'notif-profile-viewed',
          type: 'PROFILE_VIEWED',
          title: 'Your profile was viewed',
          body: 'Gulf Builders Arabia viewed your profile.',
          read: false,
          readAt: null,
          createdAt: NOW,
        } satisfies MockNotification,
        {
          id: 'notif-passport-expiry',
          type: 'PASSPORT_EXPIRY',
          title: 'Passport expiring soon',
          body: 'Your passport expires in 7 days (11 Jul 2026). Update it to keep applying.',
          read: false,
          readAt: null,
          createdAt: NOW,
        } satisfies MockNotification,
        {
          id: 'notif-1',
          type: 'APPLICATION_UPDATE',
          title: 'Application Shortlisted',
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
        {
          id: 'notif-4',
          type: 'PROFILE_REMINDER',
          title: 'Complete Your Profile',
          body: 'Your profile is 65% complete. Add your passport and experience to improve your match score.',
          read: false,
          readAt: null,
          createdAt: daysAgo(1),
        } satisfies MockNotification,
        {
          id: 'notif-5',
          type: 'JOB_MATCH',
          title: 'New Job Match',
          body: 'A Plumber role in Dubai matches your skills. Apply before the deadline.',
          read: true,
          readAt: daysAgo(1),
          relatedEntityId: 'job-3',
          relatedEntityType: 'job',
          createdAt: daysAgo(1),
        } satisfies MockNotification,
        {
          id: 'notif-6',
          type: 'DOCUMENT_STATUS',
          title: 'Passport Verified',
          body: 'Your passport document has been successfully verified.',
          read: true,
          readAt: daysAgo(14),
          createdAt: daysAgo(14),
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

// ─── S3 helpers ───────────────────────────────────────────────────────────────

export function computeProfileChecklist(userId: string): components['schemas']['ProfileChecklist'] {
  const company = db.employers.get(userId);
  const contacts = db.contactPersons.get(userId) ?? [];
  const logo = db.companyLogos.get(userId);
  const prefs = db.hiringPreferences.get(userId);

  const hasLogo = !!logo;
  const hasHiringPreferences = !!prefs;
  const hasSecondContact = contacts.length >= 2;
  const hasDescription = !!(company?.description && company.description.trim().length > 0);

  let hint: string | null = null;
  if (!hasLogo) hint = 'Add a company logo to build candidate trust';
  else if (!hasDescription) hint = 'Add a company description to attract more candidates';
  else if (!hasHiringPreferences) hint = 'Set your hiring preferences to improve candidate matches';
  else if (!hasSecondContact) hint = 'Add a second contact person for your profile';

  return { hasLogo, hasHiringPreferences, hasSecondContact, hasDescription, hint };
}

function getAgeFromDob(dob: string | undefined): number | undefined {
  if (!dob) return undefined;
  const birth = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

export function toCandidateEmployerView(
  mc: MockCandidate,
): components['schemas']['CandidateEmployerView'] {
  const p = mc.profile;
  const showPhone = mc.resumeSettings.showPhone;
  const showReligion = mc.resumeSettings.showReligion;

  const documentsStatus: components['schemas']['CandidateDocumentStatus'][] = (
    p.documents ?? []
  ).map((doc) => {
    const entry: components['schemas']['CandidateDocumentStatus'] = {
      type: doc.type,
      uploaded: true,
    };
    if (doc.type === 'PASSPORT') {
      const expired = doc.expiryDate ? new Date(doc.expiryDate) < new Date() : false;
      entry.passportValid = !expired;
    }
    return entry;
  });

  const view: components['schemas']['CandidateEmployerView'] = {
    id: p.id,
    fullName: p.fullName ?? '',
    isAvailable: p.isAvailable ?? true,
    documentsStatus,
    createdAt: p.createdAt ?? new Date().toISOString(),
  };

  const age = getAgeFromDob(p.dob);
  if (age !== undefined) view.age = age;
  if (showPhone && p.phone) view.phone = p.phone;
  if (showReligion && p.religion) view.religion = p.religion;
  if (p.nationality) view.nationality = p.nationality;
  if (p.currentLocation) view.currentLocation = p.currentLocation;
  view.jobCategoryId = p.jobCategoryId ?? null;
  view.noticePeriod = p.noticePeriod;
  view.languages = p.languages ?? [];
  view.experiences = p.experiences ?? [];
  view.skills = p.skills ?? [];

  return view;
}

export function toCandidateBrowseCard(
  mc: MockCandidate,
): components['schemas']['CandidateBrowseCard'] {
  const p = mc.profile;
  const experienceYears = (p.experiences ?? []).reduce((sum, e) => sum + (e.years ?? 0), 0);
  const hasForeignExperience = (p.experiences ?? []).some((e) => e.type === 'FOREIGN');
  const skills = (p.skills ?? []).slice(0, 3).map((s) => s.name);

  return {
    id: p.id,
    fullName: p.fullName ?? '',
    nationality: p.nationality,
    currentLocation: p.currentLocation,
    jobCategoryId: p.jobCategoryId ?? null,
    experienceYears,
    skills,
    hasForeignExperience,
    isAvailable: p.isAvailable ?? true,
    createdAt: p.createdAt ?? new Date().toISOString(),
  };
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
