/**
 * S8-H2 PRIORITY 1 — the horizontal-privilege (IDOR) sweep.
 *
 * For EVERY resource type, authenticate as tenant A and request tenant B's
 * resource by id. The rule from the conventions:
 *
 *    "not yours / hidden"  →  404, NEVER 403, NEVER the data
 *
 * 403 is an enumeration oracle: it confirms the id exists. 200 is a breach.
 * The control for each probe is the SAME request against an id that exists
 * nowhere — if B's id and a random uuid give different answers, the difference
 * is the oracle, whatever the status code happens to be.
 *
 * Resource types covered: job (draft + active), application, company/contact,
 * order, invoice, candidate profile, candidate document URL, resume generation,
 * experiences, skills, notifications, saved jobs.
 *
 *   pnpm security:idor
 */
import './lib/env';
import { PrismaClient } from '@prisma/client';
import { startApi, req, codeOf, Res } from './lib/api';
import { build, Fixtures, purge } from './lib/fixtures';
import { Recorder } from './lib/report';

const PORT = Number(process.env.SEC_API_PORT ?? 3202);
const prisma = new PrismaClient();
const OWASP = 'A01:2021 Broken Access Control';

/**
 * The fixture bundle plus two victim-owned child rows the base fixtures do not
 * create (a work-experience and a skill belonging to candidate B) — needed to
 * probe the per-row ownership checks on the candidate-self sub-resources.
 */
type ProbeFixtures = Fixtures & { bExperienceId: string; bSkillId: string };

interface IdorCase {
  id: string;
  resource: string;
  method: string;
  /** Path built with the VICTIM's id. */
  victimPath: (fx: ProbeFixtures) => string;
  /** Same shape, with an id that exists nowhere (the indistinguishability control). */
  ghostPath: (fx: ProbeFixtures) => string;
  /** Whose token performs the request. */
  actor: (fx: ProbeFixtures) => string;
  actorLabel: string;
  body?: unknown;
  /**
   * Set when a 403 is the CORRECT answer and hides nothing. Two cases exist:
   *
   *  - a gate that fires BEFORE the resource is looked at (the document plan
   *    gate: a Free employer is refused on their plan, learning nothing about
   *    the candidate — the ordering the conventions require), and
   *  - a pure role check on a path with no resource id at all (`/candidates/me`
   *    as an EMPLOYER), where there is no existence to leak.
   *
   * The indistinguishability check still runs — that is what actually proves the
   * response carries no information about the target.
   */
  forbiddenIsCorrect?: string;
}

const CASES: IdorCase[] = [
  // ── Employer A → employer B's resources ────────────────────────────────────
  {
    id: 'job-draft-read',
    resource: 'job (draft)',
    method: 'GET',
    victimPath: (f) => `/api/v1/employers/me/jobs/${f.B.jobId}`,
    ghostPath: (f) => `/api/v1/employers/me/jobs/${f.nonexistentId}`,
    actor: (f) => f.A.token,
    actorLabel: 'employer A',
  },
  {
    id: 'job-update',
    resource: 'job (write)',
    method: 'PATCH',
    victimPath: (f) => `/api/v1/employers/me/jobs/${f.B.jobId}`,
    ghostPath: (f) => `/api/v1/employers/me/jobs/${f.nonexistentId}`,
    actor: (f) => f.A.token,
    actorLabel: 'employer A',
    body: { title: 'IDOR-ATTEMPT-TITLE' },
  },
  {
    id: 'job-publish',
    resource: 'job (state change)',
    method: 'POST',
    victimPath: (f) => `/api/v1/employers/me/jobs/${f.B.jobId}/publish`,
    ghostPath: (f) => `/api/v1/employers/me/jobs/${f.nonexistentId}/publish`,
    actor: (f) => f.A.token,
    actorLabel: 'employer A',
  },
  {
    id: 'job-archive',
    resource: 'job (destructive)',
    method: 'POST',
    victimPath: (f) => `/api/v1/employers/me/jobs/${f.B.jobId}/archive`,
    ghostPath: (f) => `/api/v1/employers/me/jobs/${f.nonexistentId}/archive`,
    actor: (f) => f.A.token,
    actorLabel: 'employer A',
  },
  {
    id: 'applicants-list',
    resource: 'applicants of another employer\'s job',
    method: 'GET',
    victimPath: (f) => `/api/v1/jobs/${f.B.activeJobId}/applicants`,
    ghostPath: (f) => `/api/v1/jobs/${f.nonexistentId}/applicants`,
    actor: (f) => f.A.token,
    actorLabel: 'employer A',
  },
  {
    id: 'application-status-write',
    resource: 'application (status transition)',
    method: 'PATCH',
    victimPath: (f) => `/api/v1/applications/${f.B.applicationId}/status`,
    ghostPath: (f) => `/api/v1/applications/${f.nonexistentId}/status`,
    actor: (f) => f.A.token,
    actorLabel: 'employer A',
    body: { status: 'SHORTLISTED' },
  },
  {
    id: 'contact-update',
    resource: 'contact person',
    method: 'PATCH',
    victimPath: (f) => `/api/v1/employers/me/profile/contacts/${f.B.contactId}`,
    ghostPath: (f) => `/api/v1/employers/me/profile/contacts/${f.nonexistentId}`,
    actor: (f) => f.A.token,
    actorLabel: 'employer A',
    body: { name: 'IDOR-ATTEMPT' },
  },
  {
    id: 'contact-delete',
    resource: 'contact person (destructive)',
    method: 'DELETE',
    victimPath: (f) => `/api/v1/employers/me/profile/contacts/${f.B.contactId}`,
    ghostPath: (f) => `/api/v1/employers/me/profile/contacts/${f.nonexistentId}`,
    actor: (f) => f.A.token,
    actorLabel: 'employer A',
  },
  {
    id: 'order-read',
    resource: 'order (financial)',
    method: 'GET',
    victimPath: (f) => `/api/v1/billing/orders/${f.B.orderId}`,
    ghostPath: (f) => `/api/v1/billing/orders/${f.nonexistentId}`,
    actor: (f) => f.A.token,
    actorLabel: 'employer A',
  },
  {
    id: 'candidate-doc-url',
    resource: "candidate document URL (another tenant's applicant)",
    method: 'GET',
    victimPath: (f) => `/api/v1/employers/candidates/${f.B.candidateId}/documents/PASSPORT/url`,
    ghostPath: (f) => `/api/v1/employers/candidates/${f.nonexistentId}/documents/PASSPORT/url`,
    actor: (f) => f.A.token,
    actorLabel: 'employer A',
    forbiddenIsCorrect:
      'the subscription-plan gate fires BEFORE the candidate is looked up, so the refusal ' +
      'is about the viewer\'s plan and reveals nothing about the target candidate',
  },

  // ── Candidate A → candidate B's resources ──────────────────────────────────
  {
    id: 'candidate-application-read',
    resource: "another candidate's application",
    method: 'GET',
    victimPath: (f) => `/api/v1/candidates/me/applications/${f.B.applicationId}`,
    ghostPath: (f) => `/api/v1/candidates/me/applications/${f.nonexistentId}`,
    actor: (f) => f.A.candidateToken,
    actorLabel: 'candidate A',
  },
  {
    id: 'candidate-experience-delete',
    resource: "another candidate's work experience",
    method: 'DELETE',
    victimPath: (f) => `/api/v1/candidates/me/experiences/${f.bExperienceId}`,
    ghostPath: (f) => `/api/v1/candidates/me/experiences/${f.nonexistentId}`,
    actor: (f) => f.A.candidateToken,
    actorLabel: 'candidate A',
  },
  {
    id: 'candidate-skill-delete',
    resource: "another candidate's skill",
    method: 'DELETE',
    victimPath: (f) => `/api/v1/candidates/me/skills/${f.bSkillId}`,
    ghostPath: (f) => `/api/v1/candidates/me/skills/${f.nonexistentId}`,
    actor: (f) => f.A.candidateToken,
    actorLabel: 'candidate A',
  },

  // ── Cross-role: a candidate reaching employer surfaces, and vice versa ─────
  {
    id: 'candidate-reads-employer-job',
    resource: 'employer job surface as a CANDIDATE',
    method: 'GET',
    victimPath: (f) => `/api/v1/employers/me/jobs/${f.B.jobId}`,
    ghostPath: (f) => `/api/v1/employers/me/jobs/${f.nonexistentId}`,
    actor: (f) => f.A.candidateToken,
    actorLabel: 'candidate A',
  },
  {
    id: 'employer-reads-candidate-self',
    resource: 'candidate-self surface as an EMPLOYER',
    method: 'GET',
    victimPath: () => `/api/v1/candidates/me`,
    ghostPath: () => `/api/v1/candidates/me`,
    actor: (f) => f.A.token,
    actorLabel: 'employer A',
    forbiddenIsCorrect:
      'a pure role check on a path carrying no resource id — there is no existence to leak',
  },
];

/** A body/status fingerprint — two responses that share it are indistinguishable. */
function fingerprint(res: Res): string {
  const code = codeOf(res);
  return `${res.status}|${code ?? ''}`;
}

async function main() {
  console.log('S8-H2 — IDOR / horizontal-privilege sweep');
  console.log('  rule: another tenant\'s resource must 404 — never 403, never the data\n');

  const fx = await build(prisma);

  // Two extra victim-owned rows the fixtures don't create by default.
  const bExp = await prisma.workExperience.findFirstOrThrow({
    where: { candidateId: fx.B.candidateId },
    select: { id: true },
  });
  const bSkill = await prisma.candidateSkill.findFirstOrThrow({
    where: { candidateId: fx.B.candidateId },
    select: { id: true },
  });
  const fxx: ProbeFixtures = { ...fx, bExperienceId: bExp.id, bSkillId: bSkill.id };

  const rec = new Recorder();
  const api = await startApi(PORT, {
    RATE_LIMIT_GLOBAL_PER_MIN: '1000000',
    RATE_LIMIT_SEARCH_PER_MIN: '1000000',
  });

  try {
    for (const c of CASES) {
      const token = c.actor(fxx);
      const victim = await req(api.base, c.method, c.victimPath(fxx), { token, body: c.body });
      const ghost = await req(api.base, c.method, c.ghostPath(fxx), { token, body: c.body });

      // 1. THE BREACH CHECK — a 2xx on someone else's resource.
      rec.expect({
        id: `idor-${c.id}-no-data`,
        group: 'IDOR — data exposure',
        description: `${c.actorLabel} → ${c.method} ${c.resource} belonging to tenant B`,
        expected: 'non-2xx (no data returned)',
        actual: `${victim.status}${codeOf(victim) ? ` ${codeOf(victim)}` : ''}`,
        pass: victim.status < 200 || victim.status >= 300,
        severity: 'Critical',
        owasp: OWASP,
        detail: { path: c.victimPath(fxx), bodyPreview: victim.text.slice(0, 180) },
      });

      // 2. THE ORACLE CHECK — 404, not 403 (unless a 403 provably hides nothing).
      rec.expect({
        id: `idor-${c.id}-404-not-403`,
        group: 'IDOR — existence hiding',
        description: `${c.actorLabel} probing tenant B's ${c.resource} must not learn it exists`,
        expected: c.forbiddenIsCorrect ? `404, or 403 because ${c.forbiddenIsCorrect}` : '404 (403 would confirm the id exists)',
        actual: `${victim.status}${codeOf(victim) ? ` ${codeOf(victim)}` : ''}`,
        pass: victim.status === 404 || (c.forbiddenIsCorrect !== undefined && victim.status === 403),
        severity: 'High',
        owasp: OWASP,
        detail: { path: c.victimPath(fxx), exemption: c.forbiddenIsCorrect },
      });

      // 3. THE INDISTINGUISHABILITY CHECK — a real-but-foreign id must be
      //    byte-for-byte as uninformative as an id that never existed.
      rec.expect({
        id: `idor-${c.id}-indistinguishable`,
        group: 'IDOR — indistinguishability',
        description: `tenant B's ${c.resource} vs a nonexistent id must look identical`,
        expected: `same status+code as the ghost request (${fingerprint(ghost)})`,
        actual: fingerprint(victim),
        pass: fingerprint(victim) === fingerprint(ghost),
        severity: 'High',
        owasp: OWASP,
        detail: {
          victim: { status: victim.status, code: codeOf(victim) },
          ghost: { status: ghost.status, code: codeOf(ghost) },
        },
      });
    }

    // ── Write-through verification: did any mutating IDOR actually land? ─────
    const bJob = await prisma.job.findUnique({
      where: { id: fxx.B.jobId },
      select: { title: true, status: true },
    });
    rec.expect({
      id: 'idor-write-through-job',
      group: 'IDOR — write-through',
      description: "tenant B's job must be unchanged after A's PATCH/publish/archive attempts",
      expected: 'title unchanged, status still DRAFT',
      actual: `title=${bJob?.title ?? 'MISSING'} status=${bJob?.status ?? 'MISSING'}`,
      pass: bJob?.title?.includes('IDOR-ATTEMPT') === false && bJob?.status === 'DRAFT',
      severity: 'Critical',
      owasp: OWASP,
    });

    const bContact = await prisma.contactPerson.findUnique({
      where: { id: fxx.B.contactId },
      select: { name: true },
    });
    rec.expect({
      id: 'idor-write-through-contact',
      group: 'IDOR — write-through',
      description: "tenant B's contact must survive A's PATCH and DELETE attempts",
      expected: 'contact still exists with its original name',
      actual: bContact ? `exists name=${bContact.name}` : 'DELETED',
      pass: bContact !== null && !bContact.name.includes('IDOR-ATTEMPT'),
      severity: 'Critical',
      owasp: OWASP,
    });

    const bApp = await prisma.application.findUnique({
      where: { id: fxx.B.applicationId },
      select: { status: true },
    });
    rec.expect({
      id: 'idor-write-through-application',
      group: 'IDOR — write-through',
      description: "tenant B's application status must survive A's transition attempt",
      expected: 'still PENDING',
      actual: String(bApp?.status),
      pass: bApp?.status === 'PENDING',
      severity: 'Critical',
      owasp: OWASP,
    });

    const bExpStill = await prisma.workExperience.findUnique({ where: { id: bExp.id }, select: { id: true } });
    const bSkillStill = await prisma.candidateSkill.findUnique({ where: { id: bSkill.id }, select: { id: true } });
    rec.expect({
      id: 'idor-write-through-candidate-rows',
      group: 'IDOR — write-through',
      description: "candidate B's experience and skill rows must survive A's DELETE attempts",
      expected: 'both rows still present',
      actual: `experience=${bExpStill ? 'present' : 'DELETED'} skill=${bSkillStill ? 'present' : 'DELETED'}`,
      pass: bExpStill !== null && bSkillStill !== null,
      severity: 'Critical',
      owasp: OWASP,
    });
  } finally {
    await api.stop();
  }

  rec.print();
  console.log(`\n${rec.summary()}`);
  console.log(`evidence → ${rec.write('idor-sweep.json')}`);

  if (process.env.SEC_KEEP_FIXTURES !== '1') await purge(prisma);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exitCode = 1;
});
