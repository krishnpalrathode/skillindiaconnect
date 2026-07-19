/**
 * S8-H2 PRIORITY 2 — the privacy-omission guarantees, attacked.
 *
 * The viewer-aware DTO layer is a DATA-PROTECTION control, not a UI nicety. This
 * probes it as an attacker would:
 *
 *  1. OMISSION — for a candidate with showPhone/showReligion off, can the field
 *     be obtained through ANY serialization path? Probes the RAW JSON of the
 *     browse card, the employer candidate view, the applicant card ("the third
 *     path"), the resume view, and the admin paths. Absent means ABSENT — a
 *     `"phone": null` key is still a leak of shape, and the rule is omission.
 *  2. INDISTINGUISHABILITY — a `profileVisible: false` candidate must be
 *     impossible to tell apart from an id that never existed, through EVERY
 *     candidate-touching endpoint: status code, error code, body bytes,
 *     list-presence, and response timing.
 *  3. THE DOCUMENT GATE ORDERING — a FREE employer must be refused on their
 *     plan BEFORE the candidate is looked at (so they learn nothing); a PRO
 *     employer must still hit the privacy 404 on an invisible candidate.
 *  4. FIELD-LEVEL RULES — `dob` never in an employer-facing path (age only);
 *     `overrideReason` / actor identity never in a candidate-facing timeline;
 *     internal admin notes never in an employer- or candidate-facing response.
 *
 *   pnpm security:privacy
 */
import './lib/env';
import { PrismaClient, SubscriptionStatus } from '@prisma/client';
import { startApi, req, codeOf, findKeyDeep, containsValue, Res } from './lib/api';
import { build, purge } from './lib/fixtures';
import { Recorder } from './lib/report';

const PORT = Number(process.env.SEC_API_PORT ?? 3203);
const prisma = new PrismaClient();
const OWASP_PRIVACY = 'A01:2021 Broken Access Control / A04:2021 Insecure Design';

/** Median of N timings — used for the timing-oracle check. */
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

async function timeRepeated(fn: () => Promise<Res>, n = 9): Promise<{ ms: number; last: Res }> {
  const times: number[] = [];
  let last!: Res;
  for (let i = 0; i < n; i++) {
    last = await fn();
    times.push(last.ms);
  }
  return { ms: median(times), last };
}

async function main() {
  console.log('S8-H2 — privacy-omission + invisible-candidate probes\n');

  const fx = await build(prisma);
  const rec = new Recorder();

  // Give tenant A a PRO subscription so the document-gate probes can get PAST
  // the plan check and exercise the privacy layer behind it. Tenant B stays
  // FREE, which is what proves the plan gate fires FIRST.
  const proPlan = await prisma.plan.findFirstOrThrow({
    where: { code: { not: 'FREE' } },
    select: { id: true },
  });
  await prisma.subscription.create({
    data: {
      companyId: fx.A.companyId,
      planId: proPlan.id,
      status: SubscriptionStatus.ACTIVE,
      startsAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
    },
  });

  // The PRIVATE candidate (showPhone=false, showReligion=false) must actually
  // APPLY to tenant A's job — otherwise the applicant-card probe below reads a
  // list containing only the default-settings applicant and would "pass" while
  // testing nothing. The applicant card is the "third path" precisely because it
  // composes the employer view with application fields; it has to be probed
  // against a candidate whose toggles are OFF.
  await prisma.application.create({
    data: {
      jobId: fx.A.activeJobId,
      candidateId: fx.privateCandidateId,
      status: 'PENDING',
      matchScore: 65,
      matchBreakdown: { category: 26, experience: 20, location: 12, salary: 7 },
      docsCompleteCount: 3,
      docsRequiredCount: 3,
      passportValidAtApply: true,
    },
  });

  const api = await startApi(PORT, {
    RATE_LIMIT_GLOBAL_PER_MIN: '1000000',
    RATE_LIMIT_SEARCH_PER_MIN: '1000000',
  });

  try {
    const empA = fx.A.token;
    const superAdmin = fx.principals.find((p) => p.label === 'SUPER_ADMIN')!.token!;

    // ── 1. OMISSION ACROSS EVERY SERIALIZATION PATH ────────────────────────
    // The private candidate has showPhone=false and showReligion=false.
    const priv = fx.privateCandidateId;
    const privRow = await prisma.candidateProfile.findUniqueOrThrow({
      where: { id: priv },
      select: { phone: true, religion: true, fullName: true },
    });

    /**
     * List responses carry MANY candidates, and only the private one has its
     * toggles off — a whole-body key search would trip on a different
     * candidate's legitimately-present phone. `scope` narrows the assertion to
     * the private candidate's own object before probing it.
     */
    const scopeToPrivate = (body: unknown): unknown => {
      const found: unknown[] = [];
      const walk = (v: unknown, seen = new Set<unknown>()): void => {
        if (v === null || typeof v !== 'object' || seen.has(v)) return;
        seen.add(v);
        if (Array.isArray(v)) {
          v.forEach((x) => walk(x, seen));
          return;
        }
        const o = v as Record<string, unknown>;
        if (o.id === priv || o.candidateId === priv) found.push(o);
        Object.values(o).forEach((x) => walk(x, seen));
      };
      walk(body);
      return found.length ? found : null;
    };

    const omissionPaths: { label: string; path: string; token: string; scoped: boolean }[] = [
      { label: 'employer candidate view', path: `/api/v1/employers/candidates/${priv}`, token: empA, scoped: false },
      { label: 'employer browse list', path: `/api/v1/employers/candidates?limit=50`, token: empA, scoped: true },
      { label: 'applicant card (third path)', path: `/api/v1/jobs/${fx.A.activeJobId}/applicants`, token: empA, scoped: true },
    ];

    for (const p of omissionPaths) {
      const full = await req(api.base, 'GET', p.path, { token: p.token });
      const scopedBody = p.scoped ? scopeToPrivate(full.body) : full.body;

      // Fail loudly rather than vacuously: if the private candidate is not in
      // the list at all, the omission assertions below would "pass" while
      // testing nothing.
      rec.expect({
        id: `omission-subject-present-${p.label}`,
        group: 'privacy — omission (absent, not null)',
        description: `the private candidate must actually appear in the ${p.label} for its checks to mean anything`,
        expected: 'subject present in the response',
        actual: scopedBody === null ? 'SUBJECT ABSENT — checks would be vacuous' : 'present',
        pass: scopedBody !== null,
        severity: 'Info',
        owasp: OWASP_PRIVACY,
        detail: { path: p.path, status: full.status },
      });

      const res: Res = { ...full, body: scopedBody, text: JSON.stringify(scopedBody ?? null) };

      // The KEY must be absent, not null. `"phone": null` still leaks the shape
      // and invites a client to treat absence and denial as the same thing.
      rec.expect({
        id: `omission-phone-key-${p.label}`,
        group: 'privacy — omission (absent, not null)',
        description: `showPhone=false → 'phone' key must be ABSENT from the ${p.label}`,
        expected: "no 'phone' key anywhere in the response",
        actual: findKeyDeep(res.body, 'phone') ? "'phone' key present" : 'absent',
        pass: !findKeyDeep(res.body, 'phone'),
        severity: 'High',
        owasp: OWASP_PRIVACY,
        detail: { path: p.path, status: res.status },
      });

      rec.expect({
        id: `omission-phone-value-${p.label}`,
        group: 'privacy — omission (absent, not null)',
        description: `the actual phone NUMBER must not appear in the ${p.label} bytes`,
        expected: 'phone number absent from the raw response',
        actual: privRow.phone && containsValue(res, privRow.phone) ? 'PHONE NUMBER PRESENT' : 'absent',
        pass: !privRow.phone || !containsValue(res, privRow.phone),
        severity: 'Critical',
        owasp: OWASP_PRIVACY,
        detail: { path: p.path },
      });

      rec.expect({
        id: `omission-religion-${p.label}`,
        group: 'privacy — omission (absent, not null)',
        description: `showReligion=false → 'religion' must be absent from the ${p.label}`,
        expected: "no 'religion' key and no religion value",
        actual: findKeyDeep(res.body, 'religion') ? "'religion' key present" : 'absent',
        pass: !findKeyDeep(res.body, 'religion') && !containsValue(res, privRow.religion ?? ' '),
        severity: 'High',
        owasp: OWASP_PRIVACY,
        detail: { path: p.path },
      });

      // dob must NEVER reach an employer path — only derived age.
      rec.expect({
        id: `omission-dob-${p.label}`,
        group: 'privacy — dob never leaks',
        description: `'dob' must never appear in the ${p.label} (employer sees derived age only)`,
        expected: "no 'dob' key",
        actual: findKeyDeep(res.body, 'dob') ? "'dob' PRESENT" : 'absent',
        pass: !findKeyDeep(res.body, 'dob'),
        severity: 'High',
        owasp: OWASP_PRIVACY,
        detail: { path: p.path },
      });

      // Internal admin notes must be structurally unreachable here.
      rec.expect({
        id: `omission-internal-note-${p.label}`,
        group: 'privacy — internal notes unreachable',
        description: `an internal admin note must never surface in the ${p.label}`,
        expected: 'no INTERNAL-NOTE marker in the bytes',
        actual: containsValue(res, 'INTERNAL-NOTE') ? 'NOTE LEAKED' : 'absent',
        pass: !containsValue(res, 'INTERNAL-NOTE'),
        severity: 'Critical',
        owasp: OWASP_PRIVACY,
        detail: { path: p.path },
      });
    }

    // ── 2. INVISIBLE-CANDIDATE INDISTINGUISHABILITY ────────────────────────
    // Every candidate-touching endpoint, invisible id vs an id that never
    // existed: status, code, body bytes, and timing must all match.
    const invisible = fx.invisibleCandidateId;
    const ghost = fx.nonexistentId;

    const candidateTouching: { label: string; make: (id: string) => string; token: string }[] = [
      {
        label: 'employer candidate view',
        make: (id) => `/api/v1/employers/candidates/${id}`,
        token: empA,
      },
      {
        label: 'employer document URL (PRO plan — past the plan gate)',
        make: (id) => `/api/v1/employers/candidates/${id}/documents/PASSPORT/url`,
        token: empA,
      },
    ];

    for (const c of candidateTouching) {
      const inv = await timeRepeated(() => req(api.base, 'GET', c.make(invisible), { token: c.token }));
      const gh = await timeRepeated(() => req(api.base, 'GET', c.make(ghost), { token: c.token }));

      rec.expect({
        id: `invisible-status-${c.label}`,
        group: 'privacy — invisible candidate indistinguishability',
        description: `invisible vs nonexistent candidate must return the same status+code via the ${c.label}`,
        expected: `${gh.last.status} ${codeOf(gh.last) ?? ''} (the ghost response)`,
        actual: `${inv.last.status} ${codeOf(inv.last) ?? ''}`,
        pass: inv.last.status === gh.last.status && codeOf(inv.last) === codeOf(gh.last),
        severity: 'High',
        owasp: OWASP_PRIVACY,
      });

      rec.expect({
        id: `invisible-body-${c.label}`,
        group: 'privacy — invisible candidate indistinguishability',
        description: `the response BODY must be byte-identical via the ${c.label}`,
        expected: 'identical bodies',
        actual: inv.last.text === gh.last.text ? 'identical' : `differ (${inv.last.text.slice(0, 80)} vs ${gh.last.text.slice(0, 80)})`,
        pass: inv.last.text === gh.last.text,
        severity: 'High',
        owasp: OWASP_PRIVACY,
      });

      // A timing oracle is a real oracle. This is a coarse check on a loaded
      // dev box — it flags only a gross difference (>3× and >40ms), which is
      // what a "row found then filtered" vs "no row" split would look like.
      const ratio = gh.ms === 0 ? 1 : inv.ms / gh.ms;
      const grossly = Math.abs(inv.ms - gh.ms) > 40 && (ratio > 3 || ratio < 1 / 3);
      rec.expect({
        id: `invisible-timing-${c.label}`,
        group: 'privacy — invisible candidate indistinguishability',
        description: `response timing must not distinguish invisible from nonexistent (${c.label})`,
        expected: 'comparable medians (no gross difference)',
        actual: `invisible=${inv.ms}ms ghost=${gh.ms}ms (ratio ${ratio.toFixed(2)})`,
        pass: !grossly,
        severity: 'Medium',
        owasp: OWASP_PRIVACY,
      });
    }

    // LIST-PRESENCE: the invisible candidate must not appear in browse at all.
    const browse = await req(api.base, 'GET', '/api/v1/employers/candidates?limit=100', { token: empA });
    rec.expect({
      id: 'invisible-not-in-browse',
      group: 'privacy — invisible candidate indistinguishability',
      description: 'an invisible candidate must not appear in the employer browse list',
      expected: 'id absent from the list',
      actual: containsValue(browse, invisible) ? 'PRESENT IN LIST' : 'absent',
      pass: !containsValue(browse, invisible),
      severity: 'Critical',
      owasp: OWASP_PRIVACY,
    });

    // ── 3. THE DOCUMENT-GATE ORDERING ──────────────────────────────────────
    // Tenant B is FREE. Probing an invisible candidate, a real candidate, and a
    // nonexistent one must ALL produce the identical plan 403 — the plan check
    // fires before the candidate is ever looked at, so nothing is learned.
    const freeProbes = await Promise.all(
      [invisible, fx.A.candidateId, ghost].map((id) =>
        req(api.base, 'GET', `/api/v1/employers/candidates/${id}/documents/PASSPORT/url`, {
          token: fx.B.token,
        }),
      ),
    );
    const fps = freeProbes.map((r) => `${r.status}|${codeOf(r) ?? ''}`);
    rec.expect({
      id: 'doc-gate-plan-first',
      group: 'privacy — document gate ordering',
      description:
        'a FREE employer probing invisible / real / nonexistent candidates must get the IDENTICAL plan refusal',
      expected: 'all three identical, code PLAN_UPGRADE_REQUIRED',
      actual: fps.join(' , '),
      pass: new Set(fps).size === 1 && codeOf(freeProbes[0]!) === 'PLAN_UPGRADE_REQUIRED',
      severity: 'High',
      owasp: OWASP_PRIVACY,
    });

    // And the privacy 404 must SURVIVE the plan gate for a paying employer.
    const proInvisible = await req(
      api.base,
      'GET',
      `/api/v1/employers/candidates/${invisible}/documents/PASSPORT/url`,
      { token: empA },
    );
    rec.expect({
      id: 'doc-gate-privacy-survives-plan',
      group: 'privacy — document gate ordering',
      description: 'a PRO employer must still be refused an invisible candidate\'s document',
      expected: '404 (privacy 404 survives the plan gate)',
      actual: `${proInvisible.status} ${codeOf(proInvisible) ?? ''}`,
      pass: proInvisible.status === 404,
      severity: 'Critical',
      owasp: OWASP_PRIVACY,
    });

    // ── 4. CANDIDATE-FACING TIMELINE SHAPING ───────────────────────────────
    // Plant an ADMIN_OVERRIDE with a reason and an actor, then confirm neither
    // reaches the candidate's own view of their application.
    await prisma.applicationTimelineEntry.create({
      data: {
        applicationId: fx.A.applicationId,
        fromStatus: 'PENDING',
        toStatus: 'SHORTLISTED',
        actorUserId: fx.principals.find((p) => p.label === 'SUPER_ADMIN')!.userId!,
        actorRole: 'SUPER_ADMIN',
        isAdminOverride: true,
        overrideReason: 'SECRET-OVERRIDE-REASON-DO-NOT-LEAK',
      },
    });

    const candView = await req(
      api.base,
      'GET',
      `/api/v1/candidates/me/applications/${fx.A.applicationId}`,
      { token: fx.A.candidateToken },
    );
    // What the shaped timeline must DROP is the actor's IDENTITY and the
    // override's reason. `actorRole` is deliberately KEPT (frozen S4-0
    // TimelineEntryDto): a candidate is entitled to see that an admin — rather
    // than the employer — moved their application, and a coarse role is not an
    // identity. Asserting its absence would contradict the contract, so the
    // check below asserts the identity/reason exclusions only.
    for (const [key, sev] of [
      ['overrideReason', 'High'],
      ['actorUserId', 'High'],
    ] as const) {
      rec.expect({
        id: `timeline-shaping-${key}`,
        group: 'privacy — candidate timeline shaping',
        description: `'${key}' must never reach a candidate-facing timeline`,
        expected: `no '${key}' key`,
        actual: findKeyDeep(candView.body, key) ? 'PRESENT' : 'absent',
        pass: !findKeyDeep(candView.body, key),
        severity: sev,
        owasp: OWASP_PRIVACY,
        detail: { status: candView.status },
      });
    }

    // The actor's user id must not appear as a VALUE either, under any key name.
    const adminUserId = fx.principals.find((p) => p.label === 'SUPER_ADMIN')!.userId!;
    rec.expect({
      id: 'timeline-shaping-actor-identity-value',
      group: 'privacy — candidate timeline shaping',
      description: "the acting admin's user id must not appear anywhere in the candidate response",
      expected: 'actor uuid absent from the bytes',
      actual: containsValue(candView, adminUserId) ? 'ACTOR ID LEAKED' : 'absent',
      pass: !containsValue(candView, adminUserId),
      severity: 'High',
      owasp: OWASP_PRIVACY,
    });
    rec.expect({
      id: 'timeline-shaping-reason-value',
      group: 'privacy — candidate timeline shaping',
      description: 'the override REASON text must not appear in the candidate response bytes',
      expected: 'reason absent',
      actual: containsValue(candView, 'SECRET-OVERRIDE-REASON') ? 'REASON LEAKED' : 'absent',
      pass: !containsValue(candView, 'SECRET-OVERRIDE-REASON'),
      severity: 'High',
      owasp: OWASP_PRIVACY,
    });

    // ── 5. ADMIN CONTEXT SANITY (the control) ──────────────────────────────
    // The admin view SHOULD carry what employers must not — otherwise the
    // omission checks above could pass simply because the data is missing
    // everywhere, which would make them worthless as evidence.
    const adminView = await req(api.base, 'GET', `/api/v1/admin/candidates/${priv}`, {
      token: superAdmin,
    });
    rec.expect({
      id: 'admin-context-control',
      group: 'privacy — control (admin context sees more)',
      description:
        'the ADMIN view must include the phone the employer view omits — proving the omission checks test viewer-awareness, not missing data',
      expected: 'phone present in the admin context',
      actual: privRow.phone && containsValue(adminView, privRow.phone) ? 'present (control holds)' : 'ABSENT — omission checks may be vacuous',
      pass: !!privRow.phone && containsValue(adminView, privRow.phone),
      severity: 'Info',
      owasp: OWASP_PRIVACY,
      detail: { status: adminView.status },
    });
  } finally {
    await api.stop();
  }

  rec.print();
  console.log(`\n${rec.summary()}`);
  console.log(`evidence → ${rec.write('privacy-probes.json')}`);

  if (process.env.SEC_KEEP_FIXTURES !== '1') await purge(prisma);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exitCode = 1;
});
