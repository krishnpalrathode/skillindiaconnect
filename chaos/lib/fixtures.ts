/**
 * S8-H3 — chaos fixtures. One employer tenant, one candidate, one admin of each
 * role, plus helpers to mint tokens and make orders/generations on demand.
 *
 * Tagged `@chaos.local` / `CHAOSTEST-` and removable with `purge()`.
 */
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import {
  CompanyStatus,
  CompanyType,
  Currency,
  DocumentType,
  EmploymentType,
  Gateway,
  JobMarket,
  JobStatus,
  OrderStatus,
  PrismaClient,
  UserRole,
  UserStatus,
} from '@prisma/client';

export const CHAOS_DOMAIN = '@chaos.local';
export const CHAOS_TAG = 'CHAOSTEST-';

const SHARED_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$c2FsdHNhbHRzYWx0c2FsdA$5vXWJmpLzGvXpQ3Yl0YZ8kJ6lZ0m1nQ2rT3uV4wX5yA';

export interface ChaosFixtures {
  employerUserId: string;
  employerToken: string;
  companyId: string;
  jobId: string;
  candidateUserId: string;
  candidateId: string;
  candidateToken: string;
  /** A candidate whose whatsappCapable is TRUE — the WhatsApp-send path. */
  waCandidateUserId: string;
  waCandidateId: string;
  adminToken: string;
  adminUserId: string;
  moderatorToken: string;
  planId: string;
}

export function mintToken(userId: string, email: string, role: string): string {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) throw new Error('JWT_ACCESS_SECRET missing');
  return jwt.sign({ sub: userId, email, role, jti: randomUUID(), type: 'access' }, secret, {
    expiresIn: '4h',
  });
}

export async function purge(prisma: PrismaClient): Promise<void> {
  const companies = await prisma.company.findMany({
    where: { registrationNumber: { startsWith: CHAOS_TAG } },
    select: { id: true },
  });
  const ids = companies.map((c) => c.id);
  if (ids.length) {
    const jobs = await prisma.job.findMany({ where: { companyId: { in: ids } }, select: { id: true } });
    const jobIds = jobs.map((j) => j.id);
    if (jobIds.length) {
      await prisma.application.deleteMany({ where: { jobId: { in: jobIds } } });
      await prisma.savedJob.deleteMany({ where: { jobId: { in: jobIds } } });
      await prisma.job.deleteMany({ where: { id: { in: jobIds } } });
    }
    await prisma.invoice.deleteMany({ where: { order: { companyId: { in: ids } } } });
    await prisma.payment.deleteMany({ where: { order: { companyId: { in: ids } } } });
    await prisma.subscription.deleteMany({ where: { companyId: { in: ids } } });
    await prisma.order.deleteMany({ where: { companyId: { in: ids } } });
    await prisma.employerUser.deleteMany({ where: { companyId: { in: ids } } });
    await prisma.company.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: CHAOS_DOMAIN } } });
}

/**
 * `failWhatsapp` gives the candidate a phone number ending in `0000`, which is
 * MockWhatsappChannel's documented "not registered on WhatsApp" trigger. That
 * makes the send genuinely fail inside the real channel, so the processor's
 * failure + email-fallback branch runs for real rather than being stubbed.
 */
async function makeCandidate(
  prisma: PrismaClient,
  slug: string,
  whatsappCapable: boolean,
  failWhatsapp = false,
): Promise<{ userId: string; candidateId: string; token: string }> {
  const email = `cand-${slug}${CHAOS_DOMAIN}`;
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
      fullName: `Chaos Candidate ${slug}`,
      fatherName: 'Chaos Father',
      dob: new Date('1994-02-02'),
      phone: failWhatsapp
        ? `+9198${String(Math.floor(Math.random() * 9000) + 1000)}0000`
        : `+9198${String(Math.floor(Math.random() * 90000000) + 10000000)}`,
      phoneVerifiedAt: new Date(),
      whatsappCapable,
      waNotifications: true,
      emailNotifs: true,
      jobCategoryId: category.id,
      currentLocation: 'Pune',
      nationality: 'Indian',
      completionPct: 90,
    },
  });
  for (const type of [DocumentType.PASSPORT, DocumentType.EXPERIENCE_CERT, DocumentType.EDUCATIONAL_CERT]) {
    await prisma.candidateDocument.create({
      data: {
        candidateId: profile.id,
        type,
        r2Key: `chaos/${profile.id}/${type}.pdf`,
        fileName: `${type}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 2048,
        expiryDate: type === DocumentType.PASSPORT ? new Date(Date.now() + 400 * 86_400_000) : null,
      },
    });
  }
  await prisma.workExperience.create({
    data: {
      candidateId: profile.id,
      type: 'FOREIGN',
      country: 'UAE',
      companyName: 'Chaos Contracting',
      role: 'Electrician',
      years: 3,
      months: 6,
    },
  });
  await prisma.candidateSkill.create({ data: { candidateId: profile.id, name: 'Arc Welding' } });
  return { userId: user.id, candidateId: profile.id, token: mintToken(user.id, email, UserRole.CANDIDATE) };
}

async function makeAdmin(prisma: PrismaClient, role: UserRole): Promise<{ userId: string; token: string }> {
  const email = `${role.toLowerCase()}${CHAOS_DOMAIN}`;
  const user = await prisma.user.create({
    data: { email, passwordHash: SHARED_HASH, role, status: UserStatus.ACTIVE, termsAcceptedAt: new Date() },
  });
  return { userId: user.id, token: mintToken(user.id, email, role) };
}

export async function build(prisma: PrismaClient): Promise<ChaosFixtures> {
  await purge(prisma);

  const email = `employer${CHAOS_DOMAIN}`;
  const employer = await prisma.user.create({
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
      name: 'Chaos Tenant LLC',
      type: CompanyType.LOCAL,
      status: CompanyStatus.APPROVED,
      registrationNumber: `${CHAOS_TAG}0001`,
      industryType: 'Construction',
      phone: '+919800000000',
      location: 'Pune',
      employeeRange: '51-200',
      approvedAt: new Date(),
    },
  });
  await prisma.employerUser.create({
    data: { userId: employer.id, companyId: company.id, isPrimary: true },
  });

  const category = await prisma.jobCategory.findFirstOrThrow({ select: { id: true } });
  const job = await prisma.job.create({
    data: {
      companyId: company.id,
      title: 'Chaos Electrician',
      employmentType: EmploymentType.FULL_TIME,
      market: JobMarket.GULF,
      status: JobStatus.ACTIVE,
      location: 'Dubai',
      description: 'Chaos scenario job for failure-injection testing.',
      categoryId: category.id,
      salaryMin: 2000,
      salaryMax: 3000,
      currency: Currency.AED,
      accommodation: true,
      healthInsurance: true,
      transportation: true,
      hoursPerDay: 8,
      daysPerWeek: 6,
      publishedAt: new Date(),
      autoArchiveAt: new Date(Date.now() + 90 * 86_400_000),
    },
  });

  const cand = await makeCandidate(prisma, 'main', false);
  // whatsappCapable so the send is ATTEMPTED, with a trigger number so it FAILS
  // — the combination that exercises the failure + email-fallback path.
  const wa = await makeCandidate(prisma, 'wa', true, true);
  const admin = await makeAdmin(prisma, UserRole.SUPER_ADMIN);
  const moderator = await makeAdmin(prisma, UserRole.MODERATOR);

  const plan = await prisma.plan.findFirstOrThrow({
    where: { code: { not: 'FREE' } },
    select: { id: true },
  });

  return {
    employerUserId: employer.id,
    employerToken: mintToken(employer.id, email, UserRole.EMPLOYER),
    companyId: company.id,
    jobId: job.id,
    candidateUserId: cand.userId,
    candidateId: cand.candidateId,
    candidateToken: cand.token,
    waCandidateUserId: wa.userId,
    waCandidateId: wa.candidateId,
    adminToken: admin.token,
    adminUserId: admin.userId,
    moderatorToken: moderator.token,
    planId: plan.id,
  };
}

/** A fresh CREATED order — used by the gateway and worker-crash scenarios. */
export async function makeOrder(prisma: PrismaClient, fx: ChaosFixtures): Promise<string> {
  const order = await prisma.order.create({
    data: {
      companyId: fx.companyId,
      planId: fx.planId,
      gateway: Gateway.RAZORPAY,
      amountSubunits: 500_000,
      gstSubunits: 90_000,
      totalSubunits: 590_000,
      currency: Currency.INR,
      status: OrderStatus.CREATED,
    },
  });
  return order.id;
}
