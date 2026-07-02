import {
  PrismaClient,
  UserRole,
  UserStatus,
  CompanyType,
  CompanyStatus,
  JobMarket,
  EmploymentType,
  JobStatus,
  ApplicationStatus,
  ExperienceType,
  DocumentType,
  MaritalStatus,
  Currency,
  PlanPeriod,
  SubscriptionStatus,
  DeliveryStatus,
  WaMessageKind,
  ResumeTrigger,
  AuditStatus,
} from '@prisma/client';
import * as argon2 from 'argon2';
import { v5 as uuidv5 } from 'uuid';
import { Permission } from '../src/auth/rbac/permission.constants';

const prisma = new PrismaClient();

// Fixed namespace UUID for deterministic ids (never change this).
const NS = 'b9f1e2c0-7a3d-4e5f-8a1b-2c3d4e5f6071';
const sid = (s: string): string => uuidv5(s, NS);

const ALL_PERMS: string[] = Object.values(Permission);

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run seed in production.');
  }

  if (ALL_PERMS.length !== 20) {
    throw new Error(`Expected 20 permission keys, got ${ALL_PERMS.length}.`);
  }
  const permSet = new Set(ALL_PERMS);

  const now = new Date();
  const passwordHash = await argon2.hash('Password123!');

  // ── 1. SETTINGS ──────────────────────────────────────────────────────────────
  const settings: Array<[string, unknown, boolean]> = [
    ['worker_protection.accommodation_required', true, true],
    ['worker_protection.health_insurance_required', true, true],
    ['worker_protection.transportation_required', true, true],
    ['jobs.auto_archive_days', 90, false],
    ['jobs.require_admin_approval', false, false],
    ['jobs.free_max_active_jobs', 1, false],
    ['jobs.allow_local', true, false],
    ['jobs.allow_foreign', true, false],
    ['candidates.mandatory_documents', ['PASSPORT', 'EXPERIENCE_CERT', 'EDUCATIONAL_CERT'], false],
    ['candidates.min_completion_pct', 70, false],
    ['candidates.video_max_minutes', 5, false],
    ['candidates.video_max_mb', 500, false],
  ];
  for (const [key, value, isCoreRule] of settings) {
    await prisma.setting.upsert({
      where: { key },
      create: { key, value: value as never, isCoreRule },
      update: { value: value as never, isCoreRule },
    });
  }

  // ── 2. PLANS ─────────────────────────────────────────────────────────────────
  const plans = [
    {
      code: 'FREE',
      name: 'Free',
      priceSubunits: 0,
      period: PlanPeriod.FOREVER,
      maxActiveJobs: 1,
      features: ['1 active job', 'Basic candidate view', 'Email support'],
    },
    {
      code: 'PRO_MONTHLY',
      name: 'Pro Monthly',
      priceSubunits: 299900,
      period: PlanPeriod.MONTHLY,
      maxActiveJobs: null,
      features: [
        'Unlimited jobs',
        'WhatsApp alerts',
        'Priority listing',
        'Document access',
        'Advanced analytics',
      ],
    },
    {
      code: 'PRO_YEARLY',
      name: 'Pro Yearly',
      priceSubunits: 2499900,
      period: PlanPeriod.YEARLY,
      maxActiveJobs: null,
      features: [
        'Unlimited jobs',
        'WhatsApp alerts',
        'Priority listing',
        'Document access',
        'Advanced analytics',
        'Dedicated support',
      ],
    },
  ];
  for (const p of plans) {
    await prisma.plan.upsert({
      where: { code: p.code },
      create: { ...p, features: p.features as never },
      update: {
        name: p.name,
        priceSubunits: p.priceSubunits,
        period: p.period,
        maxActiveJobs: p.maxActiveJobs,
        features: p.features as never,
      },
    });
  }

  // ── 3. JOB CATEGORIES (10 trades) ────────────────────────────────────────────
  const cats: Array<[string, string]> = [
    ['electrician', 'Electrician'],
    ['plumber', 'Plumber'],
    ['mason', 'Mason'],
    ['welder', 'Welder'],
    ['carpenter', 'Carpenter'],
    ['steel-fixer', 'Steel Fixer'],
    ['pipe-fitter', 'Pipe Fitter'],
    ['hvac-technician', 'HVAC Technician'],
    ['driver', 'Driver'],
    ['helper', 'Helper'],
  ];
  for (const [slug, nameEn] of cats) {
    await prisma.jobCategory.upsert({
      where: { slug },
      create: { slug, nameEn, isActive: true },
      update: { nameEn, isActive: true },
    });
  }
  const electrician = await prisma.jobCategory.findUniqueOrThrow({
    where: { slug: 'electrician' },
  });
  const mason = await prisma.jobCategory.findUniqueOrThrow({ where: { slug: 'mason' } });

  // ── 4. NOTIFICATION TEMPLATES (approvedAt: null = long-lead tracking) ────────
  const templates: Array<[string, string]> = [
    ['wa.auth_otp', 'whatsapp'],
    ['wa.selected', 'whatsapp'],
    ['wa.resume_doc', 'whatsapp'],
    ['wa.manual_update', 'whatsapp'],
    ['email.application_selected', 'email'],
    ['email.application_shortlisted', 'email'],
    ['email.application_rejected', 'email'],
    ['email.profile_reminder', 'email'],
    ['email.passport_expiry', 'email'],
    ['email.employer_approved', 'email'],
    ['email.employer_rejected', 'email'],
    ['email.subscription_purchased', 'email'],
    ['email.subscription_expiring', 'email'],
  ];
  for (const [key, channel] of templates) {
    await prisma.notificationTemplate.upsert({
      where: { key },
      create: { key, channel, language: 'en', approvedAt: null },
      update: { channel, language: 'en' }, // never overwrite approvedAt
    });
  }

  // ── 5. ROLE-PERMISSION MATRIX (Screen 27, exactly the 20 keys) ───────────────
  // SUPER_ADMIN: all enabled + locked. CANDIDATE/EMPLOYER: NO rows seeded.
  const on = { enabled: true, locked: false };
  const off = { enabled: false, locked: false };
  const lockedOff = { enabled: false, locked: true };

  type PermEntry = { enabled: boolean; locked: boolean };
  const matrix: Record<string, Record<string, PermEntry>> = {
    SUPER_ADMIN: Object.fromEntries(ALL_PERMS.map((k) => [k, { enabled: true, locked: true }])),
    ADMIN: {
      'candidates.view': on,
      'candidates.edit': on,
      'candidates.delete': off,
      'candidates.onboard_manual': on,
      'candidates.export': on,
      'employers.view': on,
      'employers.approve_reject': on,
      'employers.suspend': on,
      'employers.delete': off,
      'jobs.view': on,
      'jobs.post_admin': on,
      'jobs.archive': on,
      'applications.manage': on,
      'applications.change_status': on,
      'applications.notes': on,
      'reports.view': on,
      'logs.view': on,
      'billing.manage': lockedOff,
      'subscriptions.manage': lockedOff,
      'admin_users.manage': lockedOff,
    },
    MODERATOR: {
      'candidates.view': on,
      'candidates.edit': off,
      'candidates.delete': off,
      'candidates.onboard_manual': off,
      'candidates.export': off,
      'employers.view': on,
      'employers.approve_reject': on,
      'employers.suspend': off,
      'employers.delete': off,
      'jobs.view': on,
      'jobs.post_admin': off,
      'jobs.archive': on,
      'applications.manage': off,
      'applications.change_status': off,
      'applications.notes': on,
      'reports.view': on,
      'logs.view': on,
      'billing.manage': lockedOff,
      'subscriptions.manage': lockedOff,
      'admin_users.manage': lockedOff,
    },
    SUPPORT: {
      'candidates.view': on,
      'candidates.edit': off,
      'candidates.delete': lockedOff,
      'candidates.onboard_manual': off,
      'candidates.export': off,
      'employers.view': on,
      'employers.approve_reject': off,
      'employers.suspend': off,
      'employers.delete': lockedOff,
      'jobs.view': on,
      'jobs.post_admin': off,
      'jobs.archive': off,
      'applications.manage': off,
      'applications.change_status': off,
      'applications.notes': off,
      'reports.view': on,
      'logs.view': off,
      'billing.manage': lockedOff,
      'subscriptions.manage': lockedOff,
      'admin_users.manage': lockedOff,
    },
  };

  for (const [role, perms] of Object.entries(matrix)) {
    for (const [key, v] of Object.entries(perms)) {
      if (!permSet.has(key)) {
        throw new Error(`Matrix key "${key}" is not in permission.constants.ts`);
      }
      await prisma.rolePermission.upsert({
        where: { role_permissionKey: { role: role as UserRole, permissionKey: key } },
        create: {
          role: role as UserRole,
          permissionKey: key,
          enabled: v.enabled,
          isLocked: v.locked,
        },
        update: { enabled: v.enabled, isLocked: v.locked },
      });
    }
  }

  // ── 6. USERS (one per admin role) ────────────────────────────────────────────
  const mkUser = async (email: string, role: UserRole, status: UserStatus = UserStatus.ACTIVE) =>
    prisma.user.upsert({
      where: { email },
      create: { email, role, status, passwordHash, termsAcceptedAt: now },
      update: { role, status }, // never re-hash on update
    });

  await mkUser('superadmin@skillindiaconnect.com', UserRole.SUPER_ADMIN);
  await mkUser('admin@skillindiaconnect.com', UserRole.ADMIN);
  await mkUser('moderator@skillindiaconnect.com', UserRole.MODERATOR);
  await mkUser('support@skillindiaconnect.com', UserRole.SUPPORT);

  // ── 7. COMPANIES + employer users + subscriptions (each company state) ────────
  type CompanyDef = {
    key: string;
    name: string;
    type: CompanyType;
    status: CompanyStatus;
    email: string;
    reg: string;
    loc: string;
    plan: string | null;
    rejectionReason?: string;
  };
  const companyDefs: CompanyDef[] = [
    {
      key: 'gulfstar',
      name: 'Gulf Star Contracting LLC',
      type: CompanyType.FOREIGN,
      status: CompanyStatus.APPROVED,
      email: 'hr@gulfstar.example',
      reg: 'CR-2018-45821',
      loc: 'Muscat, Oman',
      plan: 'PRO_MONTHLY',
    },
    {
      key: 'sharma',
      name: 'Sharma Builders Pvt Ltd',
      type: CompanyType.LOCAL,
      status: CompanyStatus.APPROVED,
      email: 'info@sharmabuilders.example',
      reg: 'U45200MH2019',
      loc: 'Mumbai, India',
      plan: 'FREE',
    },
    {
      key: 'alnoor',
      name: 'Al Noor Recruitment',
      type: CompanyType.FOREIGN,
      status: CompanyStatus.PENDING,
      email: 'info@alnoor.example',
      reg: 'CN-11223344',
      loc: 'Dubai, UAE',
      plan: null,
    },
    {
      key: 'rejected',
      name: 'Quickfix Labour Co',
      type: CompanyType.LOCAL,
      status: CompanyStatus.REJECTED,
      email: 'contact@quickfix.example',
      reg: 'U99999XX2020',
      loc: 'Pune, India',
      plan: null,
      rejectionReason:
        'Company registration certificate was unreadable. Please re-upload a clear copy.',
    },
  ];

  const companyById: Record<string, string> = {}; // key → company.id
  for (const c of companyDefs) {
    const companyId = sid(`company:${c.key}`);
    await prisma.company.upsert({
      where: { id: companyId },
      create: {
        id: companyId,
        name: c.name,
        type: c.type,
        status: c.status,
        registrationNumber: c.reg,
        industryType: 'Construction',
        phone: '+0000000000',
        location: c.loc,
        employeeRange: '51-200',
        approvedAt: c.status === CompanyStatus.APPROVED ? now : null,
        rejectionReason: c.rejectionReason ?? null,
      },
      update: { name: c.name, status: c.status, rejectionReason: c.rejectionReason ?? null },
    });
    companyById[c.key] = companyId;

    const eu = await mkUser(
      c.email,
      UserRole.EMPLOYER,
      c.status === CompanyStatus.SUSPENDED ? UserStatus.SUSPENDED : UserStatus.ACTIVE,
    );
    await prisma.employerUser.upsert({
      where: { userId: eu.id },
      create: { userId: eu.id, companyId, isPrimary: true },
      update: { companyId },
    });

    if (c.plan) {
      const plan = await prisma.plan.findUniqueOrThrow({ where: { code: c.plan } });
      const subId = sid(`sub:${c.key}`);
      await prisma.subscription.upsert({
        where: { id: subId },
        create: {
          id: subId,
          companyId,
          planId: plan.id,
          status: SubscriptionStatus.ACTIVE,
          startsAt: now,
          expiresAt: c.plan === 'FREE' ? null : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        },
        update: { planId: plan.id, status: SubscriptionStatus.ACTIVE },
      });
    }
  }

  // ── 8. CANDIDATES (varied completion) ────────────────────────────────────────
  type CandDef = {
    key: string;
    email: string;
    name: string;
    pct: number;
    docs: string[];
    foreign: boolean;
    skills: string[];
    resume?: boolean;
  };
  const candDefs: CandDef[] = [
    {
      key: 'ramesh',
      email: 'ramesh@example.com',
      name: 'Ramesh Kumar Yadav',
      pct: 100,
      docs: ['PASSPORT', 'EXPERIENCE_CERT', 'EDUCATIONAL_CERT'],
      foreign: true,
      skills: ['Electrical Wiring', 'Panel Installation', 'Circuit Testing'],
      resume: true,
    },
    {
      key: 'sajid',
      email: 'sajid@example.com',
      name: 'Sajid Ali',
      pct: 85,
      docs: ['PASSPORT', 'EXPERIENCE_CERT', 'EDUCATIONAL_CERT'],
      foreign: true,
      skills: ['Electrical Wiring', 'Safety Compliance'],
    },
    {
      key: 'arun',
      email: 'arun@example.com',
      name: 'Arun Prakash',
      pct: 75,
      docs: ['PASSPORT', 'EXPERIENCE_CERT'],
      foreign: true,
      skills: ['Electrical Wiring'],
    },
    {
      key: 'imran',
      email: 'imran@example.com',
      name: 'Imran Khan',
      pct: 70,
      docs: ['PASSPORT'],
      foreign: false,
      skills: [],
    },
    {
      key: 'deepak',
      email: 'deepak@example.com',
      name: 'Deepak Singh',
      pct: 40,
      docs: [],
      foreign: false,
      skills: [],
    },
  ];

  const profileIdByKey: Record<string, string> = {};

  for (const cd of candDefs) {
    const u = await mkUser(cd.email, UserRole.CANDIDATE);
    const profile = await prisma.candidateProfile.upsert({
      where: { userId: u.id },
      create: {
        userId: u.id,
        fullName: cd.name,
        jobCategoryId: electrician.id,
        phone: '+919452100000',
        phoneVerifiedAt: cd.pct >= 70 ? now : null,
        whatsappCapable: cd.pct >= 70,
        nationality: 'Indian',
        currentLocation: 'India',
        maritalStatus: MaritalStatus.MARRIED,
        languages: ['Hindi', 'English'],
        completionPct: cd.pct, // seed approximation; S1 engine recomputes
      },
      update: { fullName: cd.name, completionPct: cd.pct },
    });
    profileIdByKey[cd.key] = profile.id;

    // Work experiences — fully owned child set → delete + recreate for idempotency.
    await prisma.workExperience.deleteMany({ where: { candidateId: profile.id } });
    if (cd.pct >= 70) {
      await prisma.workExperience.create({
        data: {
          candidateId: profile.id,
          type: ExperienceType.INDIA,
          country: 'India',
          companyName: 'Larsen & Toubro',
          role: 'Electrician',
          years: 3,
        },
      });
      if (cd.foreign) {
        await prisma.workExperience.create({
          data: {
            candidateId: profile.id,
            type: ExperienceType.FOREIGN,
            country: 'United Arab Emirates',
            companyName: 'Al Futtaim Electricals',
            role: 'Electrician',
            years: 4,
          },
        });
      }
    }

    // Documents — natural key [candidateId, type] → upsert.
    for (const t of cd.docs) {
      await prisma.candidateDocument.upsert({
        where: { candidateId_type: { candidateId: profile.id, type: t as DocumentType } },
        create: {
          candidateId: profile.id,
          type: t as DocumentType,
          r2Key: `seed/${cd.key}/${t}.pdf`,
          fileName: `${t.toLowerCase()}_${cd.key}.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: 102400,
          expiryDate:
            t === 'PASSPORT' ? new Date(now.getTime() + 5 * 365 * 24 * 60 * 60 * 1000) : null,
        },
        update: {},
      });
    }

    // Skills — natural key [candidateId, name] → upsert.
    for (const s of cd.skills) {
      await prisma.candidateSkill.upsert({
        where: { candidateId_name: { candidateId: profile.id, name: s } },
        create: { candidateId: profile.id, name: s },
        update: {},
      });
    }
  }

  // Resume + one generation for ramesh.
  const rameshProfileId = profileIdByKey['ramesh']!;
  const resume = await prisma.candidateResume.upsert({
    where: { candidateId: rameshProfileId },
    create: { candidateId: rameshProfileId, language: 'en' },
    update: {},
  });
  await prisma.resumeGeneration.upsert({
    where: { id: sid('rg:ramesh') },
    create: {
      id: sid('rg:ramesh'),
      resumeId: resume.id,
      contentHash: 'seedhash',
      r2Key: 'seed/ramesh/resume.pdf',
      sizeBytes: 153600,
      trigger: ResumeTrigger.DOWNLOAD,
      settingsSnapshot: {} as never,
    },
    update: {},
  });

  // ── 9. JOBS (each status, multiple currencies) ────────────────────────────────
  const gulfId = companyById['gulfstar']!;
  const sharmaId = companyById['sharma']!;

  type JobSeed = {
    key: string;
    companyId: string;
    categoryId: string;
    title: string;
    market: JobMarket;
    status: JobStatus;
    location: string;
    description: string;
    salaryMin: number;
    salaryMax: number;
    currency: Currency;
    employmentType?: EmploymentType;
    publishedAt?: Date;
    pausedAt?: Date;
    archivedAt?: Date;
    autoArchiveAt?: Date;
  };

  const baseBenefits = { accommodation: true, healthInsurance: true, transportation: true };
  const jobSeeds: JobSeed[] = [
    {
      key: 'snr-electrician',
      companyId: gulfId,
      categoryId: electrician.id,
      title: 'Senior Electrician',
      market: JobMarket.FOREIGN,
      status: JobStatus.ACTIVE,
      location: 'Muscat, Oman',
      description: 'Experienced electricians for ongoing infrastructure projects.',
      salaryMin: 180000,
      salaryMax: 220000,
      currency: Currency.QAR,
      employmentType: EmploymentType.FULL_TIME,
      publishedAt: now,
      autoArchiveAt: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000),
    },
    {
      key: 'mason-mumbai',
      companyId: sharmaId,
      categoryId: mason.id,
      title: 'Mason',
      market: JobMarket.LOCAL,
      status: JobStatus.ACTIVE,
      location: 'Mumbai, India',
      description: 'Masons for residential construction projects.',
      salaryMin: 2200000,
      salaryMax: 2800000,
      currency: Currency.INR,
      publishedAt: now,
    },
    {
      key: 'welder-draft',
      companyId: gulfId,
      categoryId: electrician.id,
      title: 'Welder',
      market: JobMarket.FOREIGN,
      status: JobStatus.DRAFT,
      location: 'Doha, Qatar',
      description: 'Draft posting for welders.',
      salaryMin: 170000,
      salaryMax: 210000,
      currency: Currency.QAR,
    },
    {
      key: 'plumber-review',
      companyId: gulfId,
      categoryId: electrician.id,
      title: 'Industrial Plumber',
      market: JobMarket.FOREIGN,
      status: JobStatus.PENDING_REVIEW,
      location: 'Dubai, UAE',
      description: 'Awaiting admin review.',
      salaryMin: 160000,
      salaryMax: 200000,
      currency: Currency.AED,
    },
    {
      key: 'steel-paused',
      companyId: gulfId,
      categoryId: electrician.id,
      title: 'Steel Fixer',
      market: JobMarket.FOREIGN,
      status: JobStatus.PAUSED,
      location: 'Riyadh, Saudi Arabia',
      description: 'Paused by employer pending renegotiation.',
      salaryMin: 170000,
      salaryMax: 210000,
      currency: Currency.SAR,
      pausedAt: now,
    },
    {
      key: 'hvac-archived',
      companyId: gulfId,
      categoryId: electrician.id,
      title: 'HVAC Technician',
      market: JobMarket.FOREIGN,
      status: JobStatus.ARCHIVED,
      location: 'Muscat, Oman',
      description: 'Archived after position was filled.',
      salaryMin: 180000,
      salaryMax: 220000,
      currency: Currency.OMR,
      archivedAt: now,
    },
  ];

  const jobIdByKey: Record<string, string> = {};
  for (const j of jobSeeds) {
    const jobId = sid(`job:${j.key}`);
    // humanId is DB-generated — never set it in create.
    await prisma.job.upsert({
      where: { id: jobId },
      create: {
        id: jobId,
        companyId: j.companyId,
        categoryId: j.categoryId,
        title: j.title,
        market: j.market,
        status: j.status,
        location: j.location,
        description: j.description,
        salaryMin: j.salaryMin,
        salaryMax: j.salaryMax,
        currency: j.currency,
        employmentType: j.employmentType ?? EmploymentType.FULL_TIME,
        requirements: ['Valid passport with 1+ year validity', 'ITI/Diploma preferred'],
        hoursPerDay: 10,
        daysPerWeek: 6,
        publishedAt: j.publishedAt ?? null,
        pausedAt: j.pausedAt ?? null,
        archivedAt: j.archivedAt ?? null,
        autoArchiveAt: j.autoArchiveAt ?? null,
        ...baseBenefits,
      },
      update: { status: j.status, title: j.title },
    });
    jobIdByKey[j.key] = jobId;
  }

  const activeForeignJobId = jobIdByKey['snr-electrician']!;

  // ── 10. APPLICATIONS (each state) on the active foreign job ──────────────────
  type AppSeed = {
    cand: string;
    status: ApplicationStatus;
    score: number;
    bd: Record<string, number>;
    selected?: boolean;
    rejected?: boolean;
    archived?: boolean;
    override?: boolean;
  };

  const appSeeds: AppSeed[] = [
    {
      cand: 'ramesh',
      status: ApplicationStatus.SELECTED,
      score: 92,
      bd: { category: 40, expYears: 22, foreign: 20, documents: 10 },
      selected: true,
    },
    {
      cand: 'sajid',
      status: ApplicationStatus.SHORTLISTED,
      score: 85,
      bd: { category: 40, expYears: 18, foreign: 20, documents: 7 },
    },
    {
      cand: 'arun',
      status: ApplicationStatus.PENDING,
      score: 75,
      bd: { category: 40, expYears: 15, foreign: 20, documents: 0 },
    },
    {
      cand: 'imran',
      status: ApplicationStatus.REJECTED,
      score: 42,
      bd: { category: 40, expYears: 0, foreign: 0, documents: 2 },
      rejected: true,
      archived: true,
    },
    {
      cand: 'deepak',
      status: ApplicationStatus.REJECTED,
      score: 38,
      bd: { category: 20, expYears: 0, foreign: 0, documents: 0 },
      override: true,
    },
  ];

  for (const a of appSeeds) {
    const candidateId = profileIdByKey[a.cand]!;
    const appId = sid(`app:${a.cand}`);

    // humanId is DB-generated — never set it in create.
    const application = await prisma.application.upsert({
      where: { id: appId },
      create: {
        id: appId,
        jobId: activeForeignJobId,
        candidateId,
        status: a.status,
        matchScore: a.score,
        matchBreakdown: a.bd as never, // seed approximation; S4 engine computes real values
        docsCompleteCount: 3,
        docsRequiredCount: 3,
        passportValidAtApply: true,
        selectedNotifiedAt: a.selected ? now : null,
        rejectionFeedback: a.rejected ? 'Insufficient relevant experience for this role.' : null,
        archivedAt: a.archived ? now : null,
      },
      update: { status: a.status, archivedAt: a.archived ? now : null },
    });

    // Timeline — fully owned → delete + recreate for idempotency.
    await prisma.applicationTimelineEntry.deleteMany({
      where: { applicationId: application.id },
    });

    type Step = {
      from: ApplicationStatus | null;
      to: ApplicationStatus;
      actorRole: UserRole;
      override?: boolean;
    };
    const steps: Step[] = [
      { from: null, to: ApplicationStatus.PENDING, actorRole: UserRole.CANDIDATE },
    ];

    if (
      a.status === ApplicationStatus.SHORTLISTED ||
      a.status === ApplicationStatus.SELECTED ||
      a.override
    ) {
      steps.push({
        from: ApplicationStatus.PENDING,
        to: ApplicationStatus.SHORTLISTED,
        actorRole: UserRole.EMPLOYER,
      });
    }
    if (a.status === ApplicationStatus.SELECTED || a.override) {
      steps.push({
        from: ApplicationStatus.SHORTLISTED,
        to: ApplicationStatus.SELECTED,
        actorRole: UserRole.EMPLOYER,
      });
    }
    if (a.rejected && !a.override) {
      steps.push({
        from: ApplicationStatus.PENDING,
        to: ApplicationStatus.REJECTED,
        actorRole: UserRole.EMPLOYER,
      });
    }
    if (a.override) {
      steps.push({
        from: ApplicationStatus.SELECTED,
        to: ApplicationStatus.REJECTED,
        actorRole: UserRole.ADMIN,
        override: true,
      });
    }

    for (const s of steps) {
      await prisma.applicationTimelineEntry.create({
        data: {
          applicationId: application.id,
          fromStatus: s.from,
          toStatus: s.to,
          actorRole: s.actorRole,
          isAdminOverride: !!s.override,
          overrideReason: s.override
            ? 'Selection reversed after employer reported a documentation issue.'
            : null,
        },
      });
    }

    // SELECTED app → one DELIVERED WhatsApp row (upsert by waMessageId).
    if (a.selected) {
      await prisma.whatsappMessage.upsert({
        where: { waMessageId: `seed-wamid-${a.cand}-selected` },
        create: {
          waMessageId: `seed-wamid-${a.cand}-selected`,
          phone: '+919452100000',
          kind: WaMessageKind.STATUS_UPDATE,
          templateName: 'wa.selected',
          status: DeliveryStatus.DELIVERED,
          statusUpdatedAt: now,
          applicationId: application.id,
        },
        update: { status: DeliveryStatus.DELIVERED },
      });
    }
  }

  // ── 11. MISC: saved job, profile view, audit demo rows ───────────────────────
  await prisma.savedJob.upsert({
    where: { candidateId_jobId: { candidateId: rameshProfileId, jobId: activeForeignJobId } },
    create: { candidateId: rameshProfileId, jobId: activeForeignJobId },
    update: {},
  });

  await prisma.profileView.upsert({
    where: { id: sid('pv:gulfstar-ramesh') },
    create: { id: sid('pv:gulfstar-ramesh'), candidateId: rameshProfileId, companyId: gulfId },
    update: {},
  });

  // Audit demo rows are append-only → clear seed rows then re-insert.
  // Filter by JSON path meta.seed = true (PostgreSQL @> operator via Prisma).
  await prisma.auditLog.deleteMany({
    where: { meta: { path: ['seed'], equals: true } },
  });
  await prisma.auditLog.createMany({
    data: [
      {
        action: 'job.publish.blocked',
        module: 'Jobs',
        status: AuditStatus.BLOCKED,
        targetType: 'Job',
        meta: { seed: true, reason: 'Accommodation set to NO' } as never,
      },
      {
        action: 'employer.approved',
        module: 'Employer',
        status: AuditStatus.SUCCESS,
        targetType: 'Company',
        targetId: gulfId,
        meta: { seed: true } as never,
      },
      {
        action: 'whatsapp.sent',
        module: 'Notifications',
        status: AuditStatus.DELIVERED,
        meta: { seed: true, template: 'wa.selected' } as never,
      },
      {
        action: 'auth.login.failed',
        module: 'Auth',
        status: AuditStatus.FAILED,
        meta: { seed: true, attempts: 5 } as never,
      },
    ],
  });

  console.log('Seed complete ✓');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
