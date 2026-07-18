/**
 * S8-H2 — the adversarial test dataset.
 *
 * TWO TENANTS of each kind, so every ownership check has something to fail
 * against: tenant A is "me", tenant B is "the victim". Every IDOR probe is
 * "authenticate as A, ask for B's id, expect 404".
 *
 * Also creates one principal per role (SUPER_ADMIN, ADMIN, MODERATOR, SUPPORT,
 * EMPLOYER, CANDIDATE) so the authz sweep can drive every endpoint as every role.
 *
 * Everything is tagged `@sec-probe.local` / `SECPROBE-` and is removable with
 * `purge()`. Nothing here touches the S8-H1 load data or the base seed.
 */
import { randomUUID, createHash } from 'node:crypto';
import jwt from 'jsonwebtoken';
import {
  ApplicationStatus,
  CompanyStatus,
  CompanyType,
  Currency,
  DocumentType,
  EmploymentType,
  JobMarket,
  JobStatus,
  OrderStatus,
  Gateway,
  PrismaClient,
  ResumeTrigger,
  ResumeGenerationStatus,
  UserRole,
  UserStatus,
} from '@prisma/client';

export const PROBE_EMAIL_DOMAIN = '@sec-probe.local';
export const PROBE_TAG = 'SECPROBE-';

/** argon2 hash of `SecProbe#12345` — reused; these accounts never log in by password. */
const SHARED_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$c2FsdHNhbHRzYWx0c2FsdA$5vXWJmpLzGvXpQ3Yl0YZ8kJ6lZ0m1nQ2rT3uV4wX5yA';

export interface Principal {
  label: string;
  role: UserRole | 'ANON';
  userId: string | null;
  email: string | null;
  token: string | null;
}

export interface TenantBundle {
  userId: string;
  email: string;
  token: string;
  companyId: string;
  jobId: string;
  /** An ACTIVE job, publicly visible. */
  activeJobId: string;
  applicationId: string;
  candidateUserId: string;
  candidateId: string;
  candidateToken: string;
  contactId: string;
  orderId: string;
  invoiceId: string;
  resumeGenerationId: string;
  noteId: string;
}

export interface Fixtures {
  principals: Principal[];
  A: TenantBundle;
  B: TenantBundle;
  /** A candidate with profileVisible=false — the invisible-candidate probes. */
  invisibleCandidateId: string;
  invisibleCandidateUserId: string;
  /** A candidate with showPhone/showReligion off — the omission probes. */
  privateCandidateId: string;
  privateCandidateUserId: string;
  /** A candidate whose text fields carry XSS/injection payloads. */
  xssCandidateId: string;
  xssCandidateUserId: string;
  xssCandidateToken: string;
  /** An id that exists nowhere — the indistinguishability control. */
  nonexistentId: string;
}

export function mintToken(userId: string, email: string, role: string, secretOverride?: string): string {
  const secret = secretOverride ?? process.env.JWT_ACCESS_SECRET;
  if (!secret) throw new Error('JWT_ACCESS_SECRET missing');
  return jwt.sign({ sub: userId, email, role, jti: randomUUID(), type: 'access' }, secret, {
    expiresIn: '2h',
  });
}

export async function purge(prisma: PrismaClient): Promise<void> {
  const companies = await prisma.company.findMany({
    where: { registrationNumber: { startsWith: PROBE_TAG } },
    select: { id: true },
  });
  const companyIds = companies.map((c) => c.id);
  if (companyIds.length) {
    const jobs = await prisma.job.findMany({
      where: { companyId: { in: companyIds } },
      select: { id: true },
    });
    const jobIds = jobs.map((j) => j.id);
    if (jobIds.length) {
      await prisma.application.deleteMany({ where: { jobId: { in: jobIds } } });
      await prisma.savedJob.deleteMany({ where: { jobId: { in: jobIds } } });
      await prisma.job.deleteMany({ where: { id: { in: jobIds } } });
    }
    await prisma.invoice.deleteMany({ where: { order: { companyId: { in: companyIds } } } });
    await prisma.payment.deleteMany({ where: { order: { companyId: { in: companyIds } } } });
    await prisma.subscription.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.order.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.contactPerson.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.employerUser.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: PROBE_EMAIL_DOMAIN } } });
}

async function makeCandidate(
  prisma: PrismaClient,
  slug: string,
  overrides: {
    profileVisible?: boolean;
    showPhone?: boolean;
    showReligion?: boolean;
    fullName?: string;
    religion?: string;
    fatherName?: string;
  } = {},
): Promise<{ userId: string; candidateId: string; token: string; email: string }> {
  const email = `cand-${slug}${PROBE_EMAIL_DOMAIN}`;
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: SHARED_HASH,
      role: UserRole.CANDIDATE,
      status: UserStatus.ACTIVE,
      termsAcceptedAt: new Date(),
    },
  });
  const category = await prisma.jobCategory.findFirstOrThrow({ select: { id: true } });
  const profile = await prisma.candidateProfile.create({
    data: {
      userId: user.id,
      fullName: overrides.fullName ?? `Probe Candidate ${slug}`,
      fatherName: overrides.fatherName ?? `Probe Father ${slug}`,
      dob: new Date('1995-04-12'),
      phone: `+9199${String(Math.floor(Math.random() * 90000000) + 10000000)}`,
      phoneVerifiedAt: new Date(),
      whatsappCapable: true,
      religion: overrides.religion ?? 'Hindu',
      jobCategoryId: category.id,
      currentLocation: 'Mumbai',
      nationality: 'Indian',
      completionPct: 90,
      profileVisible: overrides.profileVisible ?? true,
      showPhone: overrides.showPhone ?? true,
      showReligion: overrides.showReligion ?? false,
    },
  });
  for (const type of [DocumentType.PASSPORT, DocumentType.EXPERIENCE_CERT, DocumentType.EDUCATIONAL_CERT]) {
    await prisma.candidateDocument.create({
      data: {
        candidateId: profile.id,
        type,
        r2Key: `secprobe/${profile.id}/${type}.pdf`,
        fileName: `${type}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        expiryDate: type === DocumentType.PASSPORT ? new Date(Date.now() + 400 * 86_400_000) : null,
        documentNumber: type === DocumentType.PASSPORT ? `P${slug}9988` : null,
      },
    });
  }
  await prisma.workExperience.create({
    data: {
      candidateId: profile.id,
      type: 'FOREIGN',
      country: 'UAE',
      companyName: 'Probe Contracting',
      role: 'Electrician',
      years: 4,
      months: 2,
    },
  });
  await prisma.candidateSkill.create({ data: { candidateId: profile.id, name: 'Arc Welding' } });

  return { userId: user.id, candidateId: profile.id, token: mintToken(user.id, email, UserRole.CANDIDATE), email };
}

async function makeTenant(prisma: PrismaClient, slug: string): Promise<TenantBundle> {
  const email = `emp-${slug}${PROBE_EMAIL_DOMAIN}`;
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: SHARED_HASH,
      role: UserRole.EMPLOYER,
      status: UserStatus.ACTIVE,
      termsAcceptedAt: new Date(),
    },
  });
  const company = await prisma.company.create({
    data: {
      name: `Probe Tenant ${slug} LLC`,
      type: CompanyType.FOREIGN,
      status: CompanyStatus.APPROVED,
      registrationNumber: `${PROBE_TAG}${slug}`,
      industryType: 'Construction',
      phone: '+971500000000',
      location: 'Dubai',
      employeeRange: '51-200',
      approvedAt: new Date(),
    },
  });
  await prisma.employerUser.create({ data: { userId: user.id, companyId: company.id, isPrimary: true } });

  const contact = await prisma.contactPerson.create({
    data: { companyId: company.id, name: `Contact ${slug}`, designation: 'HR', email: `hr-${slug}${PROBE_EMAIL_DOMAIN}`, phone: '+971500000001' },
  });

  const category = await prisma.jobCategory.findFirstOrThrow({ select: { id: true } });
  const baseJob = {
    companyId: company.id,
    employmentType: EmploymentType.FULL_TIME,
    market: JobMarket.GULF,
    location: 'Dubai',
    description: `Probe job for tenant ${slug}. Experienced electrician required for site work.`,
    categoryId: category.id,
    salaryMin: 2000,
    salaryMax: 3000,
    currency: Currency.AED,
    accommodation: true,
    healthInsurance: true,
    transportation: true,
    hoursPerDay: 8,
    daysPerWeek: 6,
  };
  const draftJob = await prisma.job.create({
    data: { ...baseJob, title: `Probe Draft Job ${slug}`, status: JobStatus.DRAFT },
  });
  const activeJob = await prisma.job.create({
    data: {
      ...baseJob,
      title: `Probe Active Electrician ${slug}`,
      status: JobStatus.ACTIVE,
      publishedAt: new Date(),
      autoArchiveAt: new Date(Date.now() + 90 * 86_400_000),
    },
  });

  const cand = await makeCandidate(prisma, `${slug}-applicant`);
  const application = await prisma.application.create({
    data: {
      jobId: activeJob.id,
      candidateId: cand.candidateId,
      status: ApplicationStatus.PENDING,
      matchScore: 72,
      matchBreakdown: { category: 30, experience: 22, location: 12, salary: 8 },
      docsCompleteCount: 3,
      docsRequiredCount: 3,
      passportValidAtApply: true,
    },
  });

  // An internal admin note — must never surface in employer/candidate responses.
  const adminUser = await prisma.user.findFirst({ where: { role: UserRole.SUPER_ADMIN }, select: { id: true } });
  const note = await prisma.applicationNote.create({
    data: {
      applicationId: application.id,
      authorId: adminUser?.id ?? user.id,
      authorRole: UserRole.SUPER_ADMIN,
      body: `INTERNAL-NOTE-${slug}-DO-NOT-LEAK`,
    },
  });

  const plan = await prisma.plan.findFirstOrThrow({ where: { code: { not: 'FREE' } }, select: { id: true } });
  const order = await prisma.order.create({
    data: {
      companyId: company.id,
      planId: plan.id,
      gateway: Gateway.RAZORPAY,
      amountSubunits: 500_000,
      gstSubunits: 90_000,
      totalSubunits: 590_000,
      currency: Currency.INR,
      status: OrderStatus.PAID,
    },
  });
  const invoice = await prisma.invoice.create({
    data: { orderId: order.id, number: `SECPROBE-${slug}-${Date.now() % 100000}`, pdfKey: null },
  });

  const resume = await prisma.candidateResume.create({ data: { candidateId: cand.candidateId } });
  const generation = await prisma.resumeGeneration.create({
    data: {
      resumeId: resume.id,
      status: ResumeGenerationStatus.READY,
      trigger: ResumeTrigger.DOWNLOAD,
      settingsSnapshot: { language: 'en', showPhone: true, showReligion: false, showFatherName: true, showPassportNumber: false },
      r2Key: `secprobe/resumes/${cand.candidateId}/resume.pdf`,
      sizeBytes: 1000,
      contentHash: createHash('sha256').update(slug).digest('hex'),
      generatedAt: new Date(),
    },
  });

  return {
    userId: user.id,
    email,
    token: mintToken(user.id, email, UserRole.EMPLOYER),
    companyId: company.id,
    jobId: draftJob.id,
    activeJobId: activeJob.id,
    applicationId: application.id,
    candidateUserId: cand.userId,
    candidateId: cand.candidateId,
    candidateToken: cand.token,
    contactId: contact.id,
    orderId: order.id,
    invoiceId: invoice.id,
    resumeGenerationId: generation.id,
    noteId: note.id,
  };
}

async function makeAdmin(prisma: PrismaClient, role: UserRole): Promise<Principal> {
  const email = `${role.toLowerCase()}${PROBE_EMAIL_DOMAIN}`;
  const user = await prisma.user.create({
    data: { email, passwordHash: SHARED_HASH, role, status: UserStatus.ACTIVE, termsAcceptedAt: new Date() },
  });
  return { label: role, role, userId: user.id, email, token: mintToken(user.id, email, role) };
}

export async function build(prisma: PrismaClient): Promise<Fixtures> {
  await purge(prisma);

  const A = await makeTenant(prisma, 'alpha');
  const B = await makeTenant(prisma, 'bravo');

  const invisible = await makeCandidate(prisma, 'invisible', { profileVisible: false });
  const priv = await makeCandidate(prisma, 'private', { showPhone: false, showReligion: false });

  // Stored-XSS / template-injection payloads planted in the fields that reach
  // employer views AND the resume PDF template.
  const xss = await makeCandidate(prisma, 'xss', {
    fullName: `<script>alert('xss')</script><img src=x onerror=alert(1)>`,
    fatherName: `</td></tr><script>document.location='http://evil'</script>`,
    religion: `"><svg/onload=alert(2)>`,
  });

  const principals: Principal[] = [
    { label: 'ANON', role: 'ANON', userId: null, email: null, token: null },
    await makeAdmin(prisma, UserRole.SUPER_ADMIN),
    await makeAdmin(prisma, UserRole.ADMIN),
    await makeAdmin(prisma, UserRole.MODERATOR),
    await makeAdmin(prisma, UserRole.SUPPORT),
    { label: 'EMPLOYER', role: UserRole.EMPLOYER, userId: A.userId, email: A.email, token: A.token },
    {
      label: 'CANDIDATE',
      role: UserRole.CANDIDATE,
      userId: A.candidateUserId,
      email: `cand-alpha-applicant${PROBE_EMAIL_DOMAIN}`,
      token: A.candidateToken,
    },
  ];

  return {
    principals,
    A,
    B,
    invisibleCandidateId: invisible.candidateId,
    invisibleCandidateUserId: invisible.userId,
    privateCandidateId: priv.candidateId,
    privateCandidateUserId: priv.userId,
    xssCandidateId: xss.candidateId,
    xssCandidateUserId: xss.userId,
    xssCandidateToken: xss.token,
    nonexistentId: randomUUID(),
  };
}
