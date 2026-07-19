/**
 * S8-H1 — realistic-volume seeder for load & performance testing.
 *
 * Seeds production-like volumes on TOP of the base seed (`pnpm db:seed`), which
 * supplies job categories, plans, settings and role permissions. Run that first.
 *
 *   pnpm load:seed              # seed to target volumes (idempotent)
 *   pnpm load:seed -- --reset   # delete all load-test rows, then reseed
 *   pnpm load:seed -- --purge   # delete all load-test rows and stop
 *
 * Volumes (override with env vars):
 *   LOAD_COMPANIES=200  LOAD_JOBS=10000  LOAD_CANDIDATES=20000  LOAD_APPLICATIONS=50000
 *
 * Everything created here is tagged with the LOAD_TAG marker so `--reset` can
 * remove exactly the load rows and never touch the base seed's demo data:
 *   - users     : email  `load-c<n>@loadtest.local` / `load-e<n>@loadtest.local`
 *   - companies : registrationNumber prefixed `LOADTEST-`
 *   - jobs      : belong to load companies (cascade-identified via companyId)
 *
 * Text is drawn from a trade/city/skill vocabulary rather than one repeated
 * string: an FTS index over 10k identical descriptions has a term distribution
 * nothing like production and would make the query plan meaningless.
 */
import { randomUUID } from 'node:crypto';
import {
  Currency,
  DocumentType,
  EmploymentType,
  JobMarket,
  JobStatus,
  PrismaClient,
  UserRole,
  UserStatus,
  CompanyStatus,
  CompanyType,
  ApplicationStatus,
  ExperienceType,
} from '@prisma/client';
import { loadRootEnv } from './lib/harness';

loadRootEnv(); // DATABASE_URL comes from the repo-root .env, as it does for the API

const prisma = new PrismaClient();

const LOAD_TAG = 'LOADTEST-';
const CAND_EMAIL = (n: number) => `load-c${n}@loadtest.local`;
const EMP_EMAIL = (n: number) => `load-e${n}@loadtest.local`;

const N_COMPANIES = Number(process.env.LOAD_COMPANIES ?? 200);
const N_JOBS = Number(process.env.LOAD_JOBS ?? 10_000);
const N_CANDIDATES = Number(process.env.LOAD_CANDIDATES ?? 20_000);
const N_APPLICATIONS = Number(process.env.LOAD_APPLICATIONS ?? 50_000);

/**
 * One argon2 hash reused across every load user. Hashing 20k passwords
 * individually costs minutes and proves nothing — the load scripts mint JWTs
 * directly (auth is rate-limited at 5/min/IP and is not under test here).
 * Corresponds to the password `LoadTest#12345`.
 */
const SHARED_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$c2FsdHNhbHRzYWx0c2FsdA$5vXWJmpLzGvXpQ3Yl0YZ8kJ6lZ0m1nQ2rT3uV4wX5yA';

// ─────── Vocabulary: gives the tsvector a realistic term distribution ────────

const TRADES = [
  'Electrician', 'Welder', 'Plumber', 'Mason', 'Carpenter', 'Painter',
  'Steel Fixer', 'Scaffolder', 'HVAC Technician', 'Heavy Driver',
  'Crane Operator', 'Pipe Fitter', 'Auto Mechanic', 'Site Supervisor',
  'Safety Officer', 'Storekeeper', 'Housekeeping Attendant', 'Security Guard',
  'CNC Machinist', 'Refrigeration Technician',
];

const SENIORITY = ['', 'Senior ', 'Junior ', 'Lead ', 'Assistant '];

const GULF_CITIES = ['Dubai', 'Abu Dhabi', 'Doha', 'Riyadh', 'Jeddah', 'Kuwait City', 'Muscat', 'Manama'];
const LOCAL_CITIES = ['Mumbai', 'Pune', 'Surat', 'Ahmedabad', 'Chennai', 'Hyderabad', 'Kochi', 'Lucknow'];

const SKILL_PHRASES = [
  'arc welding and MIG welding certification',
  'reading technical drawings and blueprints',
  'industrial wiring and panel installation',
  'preventive maintenance of rotating equipment',
  'scaffold erection to OSHA standards',
  'hydraulic and pneumatic systems troubleshooting',
  'concrete formwork and shuttering',
  'HVAC chiller and ducting installation',
  'forklift and telehandler operation',
  'quality inspection and NDT familiarity',
];

const DUTY_PHRASES = [
  'Work on large commercial construction projects with an experienced site team.',
  'Maintain plant equipment and report faults to the shift engineer daily.',
  'Install, test and commission systems according to project specifications.',
  'Follow all site safety procedures and attend daily toolbox talks.',
  'Coordinate with the supervisor to plan material requirements in advance.',
];

const BENEFIT_PHRASES = [
  'Company provides shared accommodation, transportation and medical insurance.',
  'Overtime paid at standard rate. Annual leave with return air ticket.',
  'Free food allowance and laundry facility available at the labour camp.',
];

/** Deterministic PRNG so a reseed produces the same corpus (comparable runs). */
function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}
const pick = <T>(rng: () => number, arr: T[]): T => arr[Math.floor(rng() * arr.length)]!;

async function chunked<T>(rows: T[], size: number, fn: (batch: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += size) {
    await fn(rows.slice(i, i + size));
    process.stdout.write(`\r    ${Math.min(i + size, rows.length)}/${rows.length}`);
  }
  process.stdout.write('\n');
}

// ─────── Purge ───────────────────────────────────────────────────────────────

async function purge() {
  console.log('purging load-test rows…');
  const companies = await prisma.company.findMany({
    where: { registrationNumber: { startsWith: LOAD_TAG } },
    select: { id: true },
  });
  const companyIds = companies.map((c) => c.id);

  if (companyIds.length) {
    const jobs = await prisma.job.findMany({ where: { companyId: { in: companyIds } }, select: { id: true } });
    const jobIds = jobs.map((j) => j.id);
    if (jobIds.length) {
      // applications reference jobs with onDelete: Restrict — clear them first
      // (timeline entries and notes cascade from the application row).
      await prisma.application.deleteMany({ where: { jobId: { in: jobIds } } });
      await prisma.savedJob.deleteMany({ where: { jobId: { in: jobIds } } });
      await prisma.job.deleteMany({ where: { id: { in: jobIds } } });
    }
    await prisma.invoice.deleteMany({ where: { order: { companyId: { in: companyIds } } } });
    await prisma.payment.deleteMany({ where: { order: { companyId: { in: companyIds } } } });
    await prisma.subscription.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.order.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.employerUser.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
  }
  // Candidate profiles/documents cascade from the user row.
  const { count } = await prisma.user.deleteMany({
    where: { email: { endsWith: '@loadtest.local' } },
  });
  console.log(`  removed ${companyIds.length} companies, ${count} users`);
}

// ─────── Seed ────────────────────────────────────────────────────────────────

async function seed() {
  const rng = makeRng(20260718);

  const categories = await prisma.jobCategory.findMany({ where: { isActive: true }, select: { id: true } });
  if (categories.length === 0) {
    throw new Error('No job categories found — run `pnpm db:seed` (base seed) first.');
  }
  const categoryIds = categories.map((c) => c.id);

  // ── Companies + employer users ────────────────────────────────────────────
  const haveCompanies = await prisma.company.count({
    where: { registrationNumber: { startsWith: LOAD_TAG } },
  });
  let companyIds: string[];
  if (haveCompanies >= N_COMPANIES) {
    console.log(`companies: ${haveCompanies} already present, skipping`);
    companyIds = (
      await prisma.company.findMany({
        where: { registrationNumber: { startsWith: LOAD_TAG } },
        select: { id: true },
      })
    ).map((c) => c.id);
  } else {
    console.log(`companies: creating ${N_COMPANIES}…`);
    const companies = Array.from({ length: N_COMPANIES }, (_, i) => ({
      id: randomUUID(),
      name: `LoadTest Contracting ${i} LLC`,
      type: i % 3 === 0 ? CompanyType.LOCAL : CompanyType.FOREIGN,
      status: CompanyStatus.APPROVED,
      registrationNumber: `${LOAD_TAG}${100000 + i}`,
      industryType: 'Construction',
      phone: `+9715${String(1000000 + i).slice(0, 7)}`,
      location: pick(rng, GULF_CITIES),
      employeeRange: '201-500',
      approvedAt: new Date(),
    }));
    await chunked(companies, 500, (b) => prisma.company.createMany({ data: b, skipDuplicates: true }));
    companyIds = companies.map((c) => c.id);

    const empUsers = companies.map((c, i) => ({
      id: randomUUID(),
      email: EMP_EMAIL(i),
      passwordHash: SHARED_PASSWORD_HASH,
      role: UserRole.EMPLOYER,
      status: UserStatus.ACTIVE,
      termsAcceptedAt: new Date(),
    }));
    await chunked(empUsers, 500, (b) => prisma.user.createMany({ data: b, skipDuplicates: true }));
    await chunked(
      empUsers.map((u, i) => ({
        userId: u.id,
        companyId: companies[i]!.id,
        isPrimary: true,
      })),
      500,
      (b) => prisma.employerUser.createMany({ data: b, skipDuplicates: true }),
    );
  }

  // ── Jobs ──────────────────────────────────────────────────────────────────
  const haveJobs = await prisma.job.count({ where: { companyId: { in: companyIds } } });
  if (haveJobs >= N_JOBS) {
    console.log(`jobs: ${haveJobs} already present, skipping`);
  } else {
    const toCreate = N_JOBS - haveJobs;
    console.log(`jobs: creating ${toCreate}…`);
    const now = Date.now();
    const jobs = Array.from({ length: toCreate }, (_, i) => {
      const trade = pick(rng, TRADES);
      const market = rng() < 0.75 ? JobMarket.GULF : JobMarket.LOCAL;
      const city = market === JobMarket.GULF ? pick(rng, GULF_CITIES) : pick(rng, LOCAL_CITIES);
      const salaryMin = 1200 + Math.floor(rng() * 30) * 100;
      // publishedAt spread over the last 120 days so the `new` badge filter,
      // the recent sort and the auto-archive window all see realistic spread.
      const publishedAt = new Date(now - Math.floor(rng() * 120) * 86_400_000);
      return {
        companyId: pick(rng, companyIds),
        title: `${pick(rng, SENIORITY)}${trade} — ${city}`,
        employmentType: EmploymentType.FULL_TIME,
        market,
        status: JobStatus.ACTIVE,
        location: city,
        description: [
          `We are hiring an experienced ${trade.toLowerCase()} for our ${city} operations.`,
          `Required: ${pick(rng, SKILL_PHRASES)}, plus ${pick(rng, SKILL_PHRASES)}.`,
          pick(rng, DUTY_PHRASES),
          pick(rng, BENEFIT_PHRASES),
        ].join(' '),
        categoryId: pick(rng, categoryIds),
        requirements: [pick(rng, SKILL_PHRASES), pick(rng, SKILL_PHRASES)],
        experienceRequiredYears: 1 + Math.floor(rng() * 8),
        salaryMin,
        salaryMax: salaryMin + 300 + Math.floor(rng() * 20) * 100,
        currency: market === JobMarket.GULF ? Currency.AED : Currency.INR,
        // Worker-protection rules are ON — a job cannot publish otherwise.
        accommodation: true,
        healthInsurance: true,
        transportation: true,
        hoursPerDay: 8 + Math.floor(rng() * 2),
        daysPerWeek: 6,
        vacancies: 1 + Math.floor(rng() * 20),
        isFeatured: rng() < 0.05,
        isUrgent: rng() < 0.1,
        publishedAt,
        autoArchiveAt: new Date(publishedAt.getTime() + 90 * 86_400_000),
      };
    });
    await chunked(jobs, 1000, (b) => prisma.job.createMany({ data: b, skipDuplicates: true }));
  }

  // ── Candidates (+ users, documents) ───────────────────────────────────────
  const haveCandidates = await prisma.user.count({
    where: { email: { startsWith: 'load-c', mode: 'insensitive' } },
  });
  if (haveCandidates >= N_CANDIDATES) {
    console.log(`candidates: ${haveCandidates} already present, skipping`);
  } else {
    console.log(`candidates: creating ${N_CANDIDATES - haveCandidates}…`);
    const users = Array.from({ length: N_CANDIDATES - haveCandidates }, (_, k) => {
      const i = haveCandidates + k;
      return {
        id: randomUUID(),
        email: CAND_EMAIL(i),
        passwordHash: SHARED_PASSWORD_HASH,
        role: UserRole.CANDIDATE,
        status: UserStatus.ACTIVE,
        termsAcceptedAt: new Date(),
      };
    });
    await chunked(users, 1000, (b) => prisma.user.createMany({ data: b, skipDuplicates: true }));

    const profiles = users.map((u, k) => ({
      id: randomUUID(),
      userId: u.id,
      fullName: `Load Candidate ${haveCandidates + k}`,
      fatherName: `Father ${haveCandidates + k}`,
      phone: `+9198${String(10000000 + haveCandidates + k).slice(0, 8)}`,
      phoneVerifiedAt: new Date(),
      whatsappCapable: (haveCandidates + k) % 3 !== 0,
      jobCategoryId: pick(rng, categoryIds),
      currentLocation: pick(rng, LOCAL_CITIES),
      nationality: 'Indian',
      // Above the 70% gate so the apply-load script exercises the full apply
      // path (gate pass → match compute → insert) rather than an early 422.
      completionPct: 85,
    }));
    console.log('  profiles…');
    await chunked(profiles, 1000, (b) => prisma.candidateProfile.createMany({ data: b, skipDuplicates: true }));

    // The three mandatory document types (candidates.mandatory_documents), with
    // a passport that is valid at apply time — otherwise gate 5 rejects.
    const mandatory: DocumentType[] = [
      DocumentType.PASSPORT,
      DocumentType.EXPERIENCE_CERT,
      DocumentType.EDUCATIONAL_CERT,
    ];
    const docs = profiles.flatMap((p, k) =>
      mandatory.map((type) => ({
        candidateId: p.id,
        type,
        r2Key: `loadtest/${p.id}/${type}.pdf`,
        fileName: `${type}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 120_000,
        expiryDate: type === DocumentType.PASSPORT ? new Date(Date.now() + 400 * 86_400_000) : null,
        documentNumber: type === DocumentType.PASSPORT ? `P${1000000 + haveCandidates + k}` : null,
      })),
    );
    console.log('  documents…');
    await chunked(docs, 2000, (b) => prisma.candidateDocument.createMany({ data: b, skipDuplicates: true }));
  }

  // ── Work history + skills ─────────────────────────────────────────────────
  // Not decoration: the resume PDF renders these. A render over an empty profile
  // produces a near-blank one-page document that costs far less time and memory
  // than a real one — it would understate the Chromium pool's ceiling.
  // Separate idempotent pass (keyed on "profile has no experience rows") so it
  // also backfills candidates seeded by an earlier version of this script.
  const bareProfiles = await prisma.candidateProfile.findMany({
    where: { user: { email: { endsWith: '@loadtest.local' } }, experiences: { none: {} } },
    select: { id: true },
  });
  if (bareProfiles.length === 0) {
    console.log('experience/skills: already present, skipping');
  } else {
    console.log(`experience/skills: filling ${bareProfiles.length} profiles…`);
    const experiences = bareProfiles.flatMap((p) =>
      Array.from({ length: 2 + Math.floor(rng() * 2) }, () => {
        const foreign = rng() < 0.6;
        return {
          candidateId: p.id,
          type: foreign ? ExperienceType.FOREIGN : ExperienceType.INDIA,
          country: foreign ? pick(rng, ['UAE', 'Qatar', 'Saudi Arabia', 'Oman']) : 'India',
          companyName: `${pick(rng, ['Al Futtaim', 'Larsen & Toubro', 'Descon', 'Gulf Marine', 'Shapoorji'])} ${Math.floor(rng() * 900) + 100}`,
          role: pick(rng, TRADES),
          years: 1 + Math.floor(rng() * 7),
          months: Math.floor(rng() * 12),
        };
      }),
    );
    console.log('  experiences…');
    await chunked(experiences, 2000, (b) =>
      prisma.workExperience.createMany({ data: b, skipDuplicates: true }),
    );

    const SKILL_NAMES = [
      'Arc Welding', 'MIG Welding', 'Blueprint Reading', 'Panel Wiring',
      'Preventive Maintenance', 'Scaffolding', 'Hydraulics', 'Forklift Operation',
      'Quality Inspection', 'First Aid',
    ];
    const skills = bareProfiles.flatMap((p) => {
      const chosen = new Set<string>();
      while (chosen.size < 5) chosen.add(pick(rng, SKILL_NAMES));
      return [...chosen].map((name) => ({ candidateId: p.id, name }));
    });
    console.log('  skills…');
    await chunked(skills, 2000, (b) => prisma.candidateSkill.createMany({ data: b, skipDuplicates: true }));
  }

  // ── Applications ──────────────────────────────────────────────────────────
  const jobIds = (
    await prisma.job.findMany({ where: { companyId: { in: companyIds } }, select: { id: true } })
  ).map((j) => j.id);
  const candidateIds = (
    await prisma.candidateProfile.findMany({
      where: { user: { email: { endsWith: '@loadtest.local' } } },
      select: { id: true },
    })
  ).map((c) => c.id);

  const haveApps = await prisma.application.count({ where: { jobId: { in: jobIds.slice(0, 1000) } } });
  const totalApps = await prisma.application.count();
  if (totalApps >= N_APPLICATIONS) {
    console.log(`applications: ${totalApps} already present (sample ${haveApps}), skipping`);
  } else {
    const toCreate = N_APPLICATIONS - totalApps;
    console.log(`applications: creating ${toCreate}…`);
    const statuses = [
      ApplicationStatus.PENDING,
      ApplicationStatus.PENDING,
      ApplicationStatus.SHORTLISTED,
      ApplicationStatus.SELECTED,
      ApplicationStatus.REJECTED,
    ];
    // (candidate, job) must be unique. For candidate c, slot s selects
    // job (c*7 + s*4001) mod |jobs| — distinct per slot for the slot counts
    // used here, so no pair repeats and skipDuplicates stays a no-op.
    const apps = Array.from({ length: toCreate }, (_, i) => {
      const c = i % candidateIds.length;
      const s = Math.floor(i / candidateIds.length);
      const jobId = jobIds[(c * 7 + s * 4001) % jobIds.length]!;
      const matchScore = 40 + Math.floor(rng() * 60);
      return {
        jobId,
        candidateId: candidateIds[c]!,
        status: pick(rng, statuses),
        matchScore,
        matchBreakdown: {
          category: Math.round(matchScore * 0.4),
          experience: Math.round(matchScore * 0.3),
          location: Math.round(matchScore * 0.2),
          salary: Math.round(matchScore * 0.1),
        },
        docsCompleteCount: 3,
        docsRequiredCount: 3,
        passportValidAtApply: true,
        createdAt: new Date(Date.now() - Math.floor(rng() * 90) * 86_400_000),
      };
    });
    await chunked(apps, 2000, (b) => prisma.application.createMany({ data: b, skipDuplicates: true }));
  }

  // ── ANALYZE: fresh planner statistics, or EXPLAIN at volume lies ──────────
  console.log('running ANALYZE…');
  await prisma.$executeRawUnsafe('ANALYZE jobs, applications, candidate_profiles, companies');

  const counts = {
    companies: await prisma.company.count(),
    jobs: await prisma.job.count(),
    activeJobs: await prisma.job.count({ where: { status: JobStatus.ACTIVE } }),
    candidates: await prisma.candidateProfile.count(),
    applications: await prisma.application.count(),
  };
  console.log('\nseeded volumes:', counts);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--purge')) {
    await purge();
    return;
  }
  if (args.includes('--reset')) await purge();
  await seed();
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
