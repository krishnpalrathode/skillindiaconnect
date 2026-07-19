/**
 * S8-H2 PRIORITY 1 — the authorization sweep.
 *
 * Drives EVERY discovered endpoint as EVERY principal (unauthenticated,
 * CANDIDATE, EMPLOYER, SUPPORT, MODERATOR, ADMIN, SUPER_ADMIN) and checks the
 * outcome against what the guards + seeded RBAC matrix say should happen.
 *
 * The expectation is COMPUTED, not hand-written per endpoint:
 *   - @Public                     → anything but 401 (the route is open)
 *   - authenticated, no perms     → must not be 401 for any logged-in role;
 *                                   authorization is the service's ownership
 *                                   check, audited separately by idor-sweep.ts
 *   - @RequirePermissions(k…)     → role HAS every k  → must NOT be 403
 *                                   role LACKS any k  → MUST be 403
 *   - no token at all             → MUST be 401 on every non-public route
 *
 * The permission set per role is read from the LIVE database (role_permissions),
 * not from the seed file, so the sweep audits the deployed matrix.
 *
 * Path params are filled with real ids owned by tenant A, so a 404 means "the
 * guard let me through and the handler didn't find it" rather than "bad uuid".
 * Mutating verbs are exercised too — this is an audit, and a write endpoint with
 * a missing guard is exactly the hole worth finding. It runs against probe-owned
 * fixtures on a disposable database.
 *
 *   pnpm security:authz
 */
import './lib/env';
import { PrismaClient } from '@prisma/client';
import { startApi, req, codeOf, Res } from './lib/api';
import { build, Fixtures, purge } from './lib/fixtures';
import { Recorder, Severity } from './lib/report';
import { collectEndpoints, EndpointRecord } from './endpoint-inventory';

const PORT = Number(process.env.SEC_API_PORT ?? 3201);
const prisma = new PrismaClient();

const OWASP_ACCESS = 'A01:2021 Broken Access Control';

/** Sample bodies for mutating routes — valid enough to pass the guards. */
function bodyFor(ep: EndpointRecord): unknown {
  const p = ep.path;
  if (p.endsWith('/auth/login')) return { email: 'nobody@sec-probe.local', password: 'x' };
  if (p.endsWith('/auth/signup')) return { email: 'nobody@sec-probe.local', password: 'Passw0rd!23', role: 'CANDIDATE', termsAccepted: true };
  if (p.endsWith('/auth/refresh')) return {};
  if (p.includes('/otp/send')) return { phone: '+919812345678', purpose: 'PHONE_VERIFY' };
  if (p.includes('/otp/verify')) return { phone: '+919812345678', code: '000000', purpose: 'PHONE_VERIFY' };
  if (p.includes('/login/phone/start')) return { phone: '+919812345678' };
  if (p.includes('/login/phone/verify')) return { phone: '+919812345678', code: '000000' };
  if (p.includes('/roles/matrix')) return { role: 'MODERATOR', permission: 'roles.view', granted: true };
  if (p.includes('/settings')) return { updates: [{ key: 'jobs.auto_archive_days', value: 90 }] };
  if (p.includes('/notes')) return { body: 'probe note' };
  if (p.includes('/status')) return { status: 'SHORTLISTED' };
  if (p.includes('/review')) return { decision: 'APPROVE' };
  if (p.includes('/flags')) return { isFeatured: false };
  if (p.includes('/reject')) return { reason: 'probe reason for rejection' };
  if (p.includes('/suspend')) return { reason: 'probe reason for suspension' };
  if (p.includes('/purge')) return { reason: 'probe reason for purge' };
  if (p.includes('/apply')) return { coverLetter: 'probe cover letter' };
  if (p.includes('/presign')) return { type: 'PASSPORT', fileName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 1024 };
  if (p.includes('/checkout')) return { planCode: 'PRO_MONTHLY' };
  if (p.includes('/employers/register')) return {};
  if (p.includes('/jobs') && ep.method === 'POST') return {};
  return {};
}

/** Fill :params with ids that genuinely exist and belong to tenant A. */
function fillPath(ep: EndpointRecord, fx: Fixtures): string {
  let p = ep.path;
  if (p.includes('/documents/:type')) p = p.replace(':type', 'PASSPORT');
  if (p.includes('/documents/:id')) p = p.replace(':id', fx.A.candidateId);
  if (p.includes('/notes/:noteId')) p = p.replace(':noteId', fx.A.noteId);

  if (p.startsWith('/api/v1/admin/candidates/:id')) p = p.replace(':id', fx.A.candidateId);
  else if (p.startsWith('/api/v1/admin/employers/:id')) p = p.replace(':id', fx.A.companyId);
  else if (p.startsWith('/api/v1/admin/jobs/:id')) p = p.replace(':id', fx.A.jobId);
  else if (p.startsWith('/api/v1/admin/applications/:id')) p = p.replace(':id', fx.A.applicationId);
  else if (p.startsWith('/api/v1/employers/candidates/:id')) p = p.replace(':id', fx.A.candidateId);
  else if (p.startsWith('/api/v1/employers/me/jobs/:id')) p = p.replace(':id', fx.A.jobId);
  else if (p.startsWith('/api/v1/employers/me/profile/contacts/:id')) p = p.replace(':id', fx.A.contactId);
  else if (p.startsWith('/api/v1/billing/orders/:id')) p = p.replace(':id', fx.A.orderId);
  else if (p.startsWith('/api/v1/applications/:id')) p = p.replace(':id', fx.A.applicationId);
  else if (p.startsWith('/api/v1/candidates/me/applications/:id')) p = p.replace(':id', fx.A.applicationId);
  else if (p.startsWith('/api/v1/candidates/me/experiences/:id')) p = p.replace(':id', fx.nonexistentId);
  else if (p.startsWith('/api/v1/candidates/me/skills/:id')) p = p.replace(':id', fx.nonexistentId);
  else if (p.startsWith('/api/v1/jobs/:id')) p = p.replace(':id', fx.A.activeJobId);

  // Anything still unreplaced gets a syntactically-valid uuid.
  p = p.replace(/:[A-Za-z]+/g, fx.nonexistentId);
  return p;
}

/**
 * Endpoints skipped from the destructive sweep, with the reason. Each is
 * covered elsewhere rather than dropped.
 */
const SKIP: Record<string, string> = {
  'DELETE /api/v1/account': 'self-deletes the sweep principal mid-run; covered by the DPDP purge probe',
  'POST /api/v1/auth/logout': 'blacklists the sweep token mid-run; covered by auth-probes.ts',
  'GET /api/v1/auth/google': 'OAuth redirect to an external IdP',
  'GET /api/v1/auth/google/callback': 'OAuth callback; requires a live IdP handshake',
  'POST /api/v1/webhooks/razorpay': 'signature-verified; covered adversarially by webhook-probes.ts',
  'POST /api/v1/webhooks/stripe': 'signature-verified; covered adversarially by webhook-probes.ts',
};

async function permissionsByRole(): Promise<Record<string, Set<string>>> {
  const rows = await prisma.rolePermission.findMany({
    select: { role: true, permissionKey: true, enabled: true },
  });
  const out: Record<string, Set<string>> = {};
  for (const r of rows) {
    (out[r.role] ??= new Set());
    if (r.enabled) out[r.role]!.add(r.permissionKey);
  }
  return out;
}

async function main() {
  console.log('S8-H2 — authorization sweep (every endpoint × every role)');
  console.log('  target: compiled build (apps/api/dist), probe fixtures, mocked providers\n');

  const endpoints = (await collectEndpoints()).filter(
    (e) => !SKIP[`${e.method} ${e.path}`] && e.method !== 'ALL',
  );
  const fx = await build(prisma);
  const perms = await permissionsByRole();
  const rec = new Recorder();

  const api = await startApi(PORT, {
    // Take the throttler out of the picture: 113 endpoints × 7 principals is
    // ~790 requests and would otherwise measure the rate limiter, masking the
    // authorization results the sweep exists to collect. Limits are audited
    // directly in auth-probes.ts.
    RATE_LIMIT_GLOBAL_PER_MIN: '1000000',
    RATE_LIMIT_SEARCH_PER_MIN: '1000000',
  });
  console.log(`API up on ${api.base}\n`);

  const matrix: {
    method: string;
    path: string;
    klass: string;
    permissions: string;
    role: string;
    expected: string;
    status: number;
    code: string | null;
    verdict: string;
  }[] = [];

  try {
    for (const ep of endpoints) {
      for (const principal of fx.principals) {
        const path = fillPath(ep, fx);
        const body = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(ep.method) ? bodyFor(ep) : undefined;
        const res: Res = await req(api.base, ep.method, path, { token: principal.token, body });

        const role = principal.label;
        const rolePerms = principal.role === 'ANON' ? new Set<string>() : perms[principal.role] ?? new Set<string>();
        const isAdminRole = ['SUPER_ADMIN', 'ADMIN', 'MODERATOR', 'SUPPORT'].includes(role);

        let expected: string;
        let pass: boolean;
        let severity: Severity = 'High';
        let description = `${role} → ${ep.method} ${ep.path}`;

        if (ep.isPublic) {
          // "Reachable" means the AUTH GUARD did not reject it — not that the
          // request succeeded. Credential-verifying routes (login, refresh,
          // phone-login) answer 401 for bad credentials while being fully
          // public, and that 401 carries a domain code (INVALID_CREDENTIALS /
          // INVALID_REFRESH / INVALID_OTP) rather than the guard's bare 401.
          // Treating that as a finding would be a false positive; the real
          // property to assert is that a bare, code-less guard rejection never
          // happens on a public route.
          const credentialCodes = ['INVALID_CREDENTIALS', 'INVALID_REFRESH', 'INVALID_OTP', 'OTP_EXPIRED'];
          const code = codeOf(res);
          pass = res.status !== 401 || (code !== null && credentialCodes.includes(code));
          expected = 'not rejected by the auth guard (a credential 401 is fine)';
          severity = 'Medium';
        } else if (principal.role === 'ANON') {
          // THE bypass check: no token must never reach a handler.
          expected = '401';
          pass = res.status === 401;
          severity = 'Critical';
          description = `unauthenticated → ${ep.method} ${ep.path} must be rejected`;
        } else if (ep.permissions.length > 0) {
          const missing = ep.permissions.filter((k) => !rolePerms.has(k));
          if (missing.length > 0) {
            // Vertical-escalation check: the role lacks the key, so the
            // PermissionsGuard must deny with 403 regardless of the handler.
            expected = '403 (lacks ' + missing.join(', ') + ')';
            pass = res.status === 403;
            severity = 'Critical';
            description = `${role} lacks [${missing.join(', ')}] → ${ep.method} ${ep.path} must be denied`;
          } else {
            expected = 'not 403 (holds ' + ep.permissions.join(', ') + ')';
            pass = res.status !== 403;
            severity = 'Medium';
            description = `${role} holds [${ep.permissions.join(', ')}] → ${ep.method} ${ep.path} must be allowed through the guard`;
          }
        } else {
          // Authenticated, no @RequirePermissions. Authorization here is the
          // service's ownership check. The only thing the sweep can assert is
          // that authentication was honoured; ownership is idor-sweep.ts's job.
          // Admin roles hitting an owner-scoped route (no company/profile) are
          // EXPECTED to fail — that is correct behaviour, not a hole.
          expected = 'authenticated (not 401)';
          pass = res.status !== 401;
          severity = isAdminRole ? 'Low' : 'Medium';
        }

        rec.expect({
          id: `${ep.method} ${ep.path} [${role}]`,
          group: ep.permissions.length > 0 ? 'RBAC-gated' : ep.isPublic ? 'public' : 'auth-only',
          description,
          expected,
          actual: `${res.status}${codeOf(res) ? ` ${codeOf(res)}` : ''}`,
          pass,
          severity,
          owasp: OWASP_ACCESS,
          detail: { permissions: ep.permissions, controller: ep.controller },
        });

        matrix.push({
          method: ep.method,
          path: ep.path,
          klass: ep.klass,
          permissions: ep.permissions.join(', ') || '—',
          role,
          expected,
          status: res.status,
          code: codeOf(res),
          verdict: pass ? 'OK' : 'DEVIATION',
        });
      }
    }

    // ── 403-vs-404 convention on ADMIN reads of a nonexistent id ────────────
    // A permission-holding admin asking for an id that does not exist must get
    // 404 — never 200, never a 500 that reveals internals.
    for (const [label, path] of [
      ['candidate', `/api/v1/admin/candidates/${fx.nonexistentId}`],
      ['employer', `/api/v1/admin/employers/${fx.nonexistentId}`],
      ['job', `/api/v1/admin/jobs/${fx.nonexistentId}`],
      ['application', `/api/v1/admin/applications/${fx.nonexistentId}`],
    ] as const) {
      const superAdmin = fx.principals.find((p) => p.label === 'SUPER_ADMIN')!;
      const res = await req(api.base, 'GET', path, { token: superAdmin.token });
      rec.expect({
        id: `admin-404-${label}`,
        group: 'existence-hiding',
        description: `SUPER_ADMIN reading a nonexistent ${label} id`,
        expected: '404',
        actual: String(res.status),
        pass: res.status === 404,
        severity: 'Low',
        owasp: OWASP_ACCESS,
      });
    }
  } finally {
    await api.stop();
  }

  rec.print();
  console.log(`\n${rec.summary()}`);

  const file = rec.write('authz-sweep.json');
  const { writeFileSync } = await import('node:fs');
  const path2 = await import('node:path');
  writeFileSync(path2.join(path2.dirname(file), 'authz-matrix.json'), JSON.stringify(matrix, null, 2));
  console.log(`evidence → ${file}`);

  await prisma.$disconnect();
  if (process.env.SEC_KEEP_FIXTURES !== '1') {
    const p2 = new PrismaClient();
    await purge(p2);
    await p2.$disconnect();
  }
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exitCode = 1;
});
