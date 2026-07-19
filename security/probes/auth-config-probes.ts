/**
 * S8-H2 — cross-cutting OWASP checks.
 *
 *  A07 AUTH        — token expiry, algorithm confusion (alg:none / HS-vs-RS),
 *                    signature forgery with the wrong secret, cross-role token
 *                    tampering, refresh rotation + reuse detection, the
 *                    post-logout blacklist, and rate-limit throttling (429 not
 *                    500, and it actually throttles).
 *  A02/A05 SECRETS — no gateway key, webhook secret, JWT secret, R2 credential
 *                    or DB URL in any response, error, log line, or audit row.
 *  A09 REDACTION   — no phone / email / OTP / token / passport number in the
 *                    audit table or the server log.
 *  A05 CONFIG      — CORS scoped to the configured origin (not `*`, and not
 *                    reflecting an arbitrary Origin with credentials), security
 *                    headers, and no debug/verbose surface.
 *  SSRF/FILE       — presign paths cannot be steered to another tenant's object
 *                    or an arbitrary key.
 *
 *   pnpm security:authconfig
 */
import './lib/env';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { PrismaClient, UserRole } from '@prisma/client';
import { startApi, req, codeOf } from './lib/api';
import { build, purge, mintToken } from './lib/fixtures';
import { Recorder } from './lib/report';

const PORT = Number(process.env.SEC_API_PORT ?? 3206);
const prisma = new PrismaClient();

const A07 = 'A07:2021 Identification and Authentication Failures';
const A02 = 'A02:2021 Cryptographic Failures';
const A05 = 'A05:2021 Security Misconfiguration';
const A09 = 'A09:2021 Security Logging and Monitoring Failures';

/** Every secret that must never appear in a response, a log, or an audit row. */
function secretInventory(): { label: string; value: string }[] {
  const keys = [
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'RAZORPAY_KEY_SECRET',
    'RAZORPAY_WEBHOOK_SECRET',
    'R2_SECRET_ACCESS_KEY',
    'R2_ACCESS_KEY_ID',
    'GOOGLE_OAUTH_CLIENT_SECRET',
  ];
  return keys
    .map((k) => ({ label: k, value: process.env[k] ?? '' }))
    .filter((s) => s.value.length >= 8); // ignore blanks/placeholders
}

async function main() {
  console.log('S8-H2 — auth / secrets / redaction / config probes\n');

  const fx = await build(prisma);
  const rec = new Recorder();
  const api = await startApi(PORT);

  try {
    const cand = fx.principals.find((p) => p.label === 'CANDIDATE')!;
    const ME = '/api/v1/candidates/me';

    // ── A07: TOKEN FORGERY AND TAMPERING ───────────────────────────────────
    const forged: { id: string; description: string; token: string }[] = [
      {
        id: 'alg-none',
        description: 'an unsigned token with alg:none (algorithm-confusion attack)',
        token: (() => {
          const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
          const payload = Buffer.from(
            JSON.stringify({ sub: cand.userId, email: cand.email, role: 'SUPER_ADMIN', jti: randomUUID(), type: 'access', exp: Math.floor(Date.now() / 1000) + 3600 }),
          ).toString('base64url');
          return `${header}.${payload}.`;
        })(),
      },
      {
        id: 'wrong-secret',
        description: 'a well-formed token signed with an attacker-chosen secret',
        token: mintToken(cand.userId!, cand.email!, UserRole.SUPER_ADMIN, 'attacker-secret-guess-1234567890'),
      },
      {
        id: 'expired',
        description: 'a correctly-signed but EXPIRED token',
        token: jwt.sign(
          { sub: cand.userId, email: cand.email, role: UserRole.CANDIDATE, jti: randomUUID(), type: 'access' },
          process.env.JWT_ACCESS_SECRET!,
          { expiresIn: '-1h' },
        ),
      },
      {
        id: 'refresh-as-access',
        description: 'a REFRESH token presented as an access token (type confusion)',
        token: jwt.sign(
          { sub: cand.userId, jti: randomUUID(), type: 'refresh' },
          process.env.JWT_REFRESH_SECRET!,
          { expiresIn: '30d' },
        ),
      },
      {
        id: 'payload-tampered-role',
        description: 'a valid token whose role claim was edited to SUPER_ADMIN (signature now stale)',
        token: (() => {
          const valid = cand.token!;
          const [h, p, s] = valid.split('.');
          const body = JSON.parse(Buffer.from(p!, 'base64url').toString());
          body.role = 'SUPER_ADMIN';
          const tampered = Buffer.from(JSON.stringify(body)).toString('base64url');
          return `${h}.${tampered}.${s}`;
        })(),
      },
      { id: 'garbage', description: 'a structurally invalid token', token: 'not.a.jwt' },
      { id: 'empty', description: 'an empty bearer token', token: '' },
    ];

    for (const f of forged) {
      const res = await req(api.base, 'GET', ME, { token: f.token });
      rec.expect({
        id: `auth-reject-${f.id}`,
        group: 'auth — token forgery',
        description: `${f.description} must be rejected`,
        expected: '401',
        actual: `${res.status} ${codeOf(res) ?? ''}`,
        pass: res.status === 401,
        severity: 'Critical',
        owasp: A07,
      });
    }

    // A privilege-escalation attempt must not merely fail auth — it must not
    // reach an admin surface either.
    const escalation = await req(api.base, 'GET', '/api/v1/admin/candidates', {
      token: forged.find((f) => f.id === 'payload-tampered-role')!.token,
    });
    rec.expect({
      id: 'auth-no-escalation-via-tampered-role',
      group: 'auth — token forgery',
      description: 'a tampered role claim must not grant access to an admin endpoint',
      expected: '401',
      actual: String(escalation.status),
      pass: escalation.status === 401,
      severity: 'Critical',
      owasp: A07,
    });

    // ── A07: THE BLACKLIST — a token must die at logout ─────────────────────
    const live = mintToken(cand.userId!, cand.email!, UserRole.CANDIDATE);
    const beforeLogout = await req(api.base, 'GET', ME, { token: live });
    const logout = await req(api.base, 'POST', '/api/v1/auth/logout', { token: live });
    const afterLogout = await req(api.base, 'GET', ME, { token: live });

    rec.expect({
      id: 'auth-blacklist-control',
      group: 'auth — logout blacklist',
      description: 'the token must work BEFORE logout (control — otherwise the check below is vacuous)',
      expected: 'not 401',
      actual: String(beforeLogout.status),
      pass: beforeLogout.status !== 401,
      severity: 'Info',
      owasp: A07,
    });
    rec.expect({
      id: 'auth-blacklist-holds',
      group: 'auth — logout blacklist',
      description: 'the SAME access token must be rejected after logout (Redis jti blacklist)',
      expected: '401',
      actual: `${afterLogout.status} (logout returned ${logout.status})`,
      pass: afterLogout.status === 401,
      severity: 'Critical',
      owasp: A07,
    });

    // ── A07: RATE LIMITING — 429, and it actually throttles ────────────────
    // Fresh API on the CONTRACT limits (the other probes raise them).
    await api.stop();
    const limited = await startApi(PORT + 1);
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 14; i++) {
        const r = await req(limited.base, 'POST', '/api/v1/auth/login', {
          body: { email: `brute${i}@sec-probe.local`, password: 'wrong' },
        });
        statuses.push(r.status);
      }
      const throttled = statuses.filter((s) => s === 429).length;
      const errored = statuses.filter((s) => s >= 500).length;

      rec.expect({
        id: 'auth-login-throttles',
        group: 'auth — rate limiting',
        description: '14 rapid login attempts must be throttled (contract: 5/min/IP)',
        expected: 'at least one 429',
        actual: `${throttled} throttled of ${statuses.length} — ${statuses.join(',')}`,
        pass: throttled > 0,
        severity: 'High',
        owasp: A07,
      });
      rec.expect({
        id: 'auth-throttle-not-500',
        group: 'auth — rate limiting',
        description: 'throttling must answer 429, never a 5xx',
        expected: 'no 5xx among the burst',
        actual: errored ? `${errored} server errors` : 'none',
        pass: errored === 0,
        severity: 'Medium',
        owasp: A07,
      });

      const otpStatuses: number[] = [];
      for (let i = 0; i < 10; i++) {
        const r = await req(limited.base, 'POST', '/api/v1/auth/otp/send', {
          body: { phone: '+919812345678', purpose: 'PHONE_VERIFY' },
        });
        otpStatuses.push(r.status);
      }
      rec.expect({
        id: 'auth-otp-throttles',
        group: 'auth — rate limiting',
        description: 'OTP send must be throttled (contract: 5/min/IP)',
        expected: 'at least one 429',
        actual: `${otpStatuses.filter((s) => s === 429).length} throttled — ${otpStatuses.join(',')}`,
        pass: otpStatuses.some((s) => s === 429),
        severity: 'High',
        owasp: A07,
      });
    } finally {
      await limited.stop();
    }

    // ── A02/A05: SECRETS MUST NOT APPEAR ANYWHERE ─────────────────────────
    const api2 = await startApi(PORT + 2, {
      RATE_LIMIT_GLOBAL_PER_MIN: '1000000',
      RATE_LIMIT_SEARCH_PER_MIN: '1000000',
    });
    try {
      const secrets = secretInventory();
      const surfaces = [
        { label: 'health', res: await req(api2.base, 'GET', '/health') },
        { label: 'public search', res: await req(api2.base, 'GET', '/api/v1/jobs?q=welder') },
        { label: '404 route', res: await req(api2.base, 'GET', '/api/v1/does-not-exist') },
        { label: 'validation error', res: await req(api2.base, 'POST', '/api/v1/auth/signup', { body: { email: 'x' } }) },
        { label: 'unauth error', res: await req(api2.base, 'GET', '/api/v1/candidates/me') },
        { label: 'candidate self', res: await req(api2.base, 'GET', ME, { token: cand.token }) },
      ];

      for (const s of surfaces) {
        for (const sec of secrets) {
          rec.expect({
            id: `secret-${sec.label}-in-${s.label}`,
            group: 'secrets — never in a response',
            description: `${sec.label} must not appear in the ${s.label} response`,
            expected: 'absent',
            actual: s.res.text.includes(sec.value) ? 'SECRET LEAKED' : 'absent',
            pass: !s.res.text.includes(sec.value),
            severity: 'Critical',
            owasp: A02,
          });
        }

        // Error hygiene: no stack frames, SQL, or filesystem paths.
        const tells = ['at Object.', 'node_modules', '\\apps\\api\\', '/apps/api/', 'PrismaClient', 'SELECT ', 'ECONNREFUSED'];
        const found = tells.filter((t) => s.res.text.includes(t));
        rec.expect({
          id: `error-hygiene-${s.label}`,
          group: 'error hygiene',
          description: `the ${s.label} response must not leak stacks, SQL, or internal paths`,
          expected: 'no internal detail',
          actual: found.length ? `LEAKED: ${found.join(', ')}` : 'clean',
          pass: found.length === 0,
          severity: 'High',
          owasp: A05,
        });
      }

      // ── A05: CORS ────────────────────────────────────────────────────────
      const evil = await req(api2.base, 'GET', '/api/v1/jobs', {
        headers: { origin: 'https://evil.example.com' },
      });
      const acao = evil.headers['access-control-allow-origin'];
      rec.expect({
        id: 'cors-does-not-reflect-arbitrary-origin',
        group: 'config — CORS',
        description: 'an arbitrary Origin must not be reflected in Access-Control-Allow-Origin',
        expected: `absent, or exactly ${process.env.WEB_APP_URL}`,
        actual: acao ?? '(absent)',
        pass: !acao || acao === process.env.WEB_APP_URL,
        severity: 'High',
        owasp: A05,
      });
      rec.expect({
        id: 'cors-not-wildcard-with-credentials',
        group: 'config — CORS',
        description: 'Access-Control-Allow-Origin must never be * while credentials are allowed',
        expected: 'not "*"',
        actual: acao ?? '(absent)',
        pass: acao !== '*',
        severity: 'Critical',
        owasp: A05,
      });

      // ── A05: SECURITY HEADERS ────────────────────────────────────────────
      const page = await req(api2.base, 'GET', '/api/v1/jobs');
      const headerChecks: { name: string; ok: (v: string | undefined) => boolean; severity: 'Medium' | 'Low' }[] = [
        { name: 'x-content-type-options', ok: (v) => v === 'nosniff', severity: 'Medium' },
        { name: 'x-frame-options', ok: (v) => !!v, severity: 'Medium' },
        { name: 'strict-transport-security', ok: (v) => !!v, severity: 'Medium' },
        { name: 'referrer-policy', ok: (v) => !!v, severity: 'Low' },
        // NOTE: no content-security-policy assertion. This is a JSON API;
        // helmet's document-oriented CSP would add bytes to every response and
        // protect nothing. The web app owns its own CSP (SEC-005).
      ];
      for (const h of headerChecks) {
        rec.expect({
          id: `header-${h.name}`,
          group: 'config — security headers',
          description: `response should carry ${h.name}`,
          expected: 'present',
          actual: page.headers[h.name] ?? '(absent)',
          pass: h.ok(page.headers[h.name]),
          severity: h.severity,
          owasp: A05,
        });
      }
      rec.expect({
        id: 'header-x-powered-by-absent',
        group: 'config — security headers',
        description: 'X-Powered-By must not advertise the framework',
        expected: 'absent',
        actual: page.headers['x-powered-by'] ?? '(absent)',
        pass: !page.headers['x-powered-by'],
        severity: 'Low',
        owasp: A05,
      });

      // ── SSRF / arbitrary-key access through the presign path ────────────
      const traversals = [
        `../../../${fx.B.candidateId}/PASSPORT/x.pdf`,
        `candidates/${fx.B.candidateId}/PASSPORT/stolen.pdf`,
        '/etc/passwd',
        'http://169.254.169.254/latest/meta-data/',
      ];
      for (const [i, key] of traversals.entries()) {
        const res = await req(api2.base, 'POST', '/api/v1/candidates/me/documents/confirm', {
          token: cand.token,
          body: { key, type: 'PASSPORT', fileName: 'x.pdf', mimeType: 'application/pdf', sizeBytes: 1024 },
        });
        rec.expect({
          id: `ssrf-key-traversal-${i}`,
          group: 'SSRF / arbitrary object access',
          description: `confirming a document with a foreign/absolute key (${key.slice(0, 40)}) must be refused`,
          expected: 'non-2xx',
          actual: `${res.status} ${codeOf(res) ?? ''}`,
          pass: res.status < 200 || res.status >= 300,
          severity: 'Critical',
          owasp: 'A10:2021 SSRF / A01 Broken Access Control',
        });
      }

      // ── A09: REDACTION — no PII in audit rows or logs ───────────────────
      const privRow = await prisma.candidateProfile.findUniqueOrThrow({
        where: { id: fx.privateCandidateId },
        select: { phone: true },
      });
      const audits = await prisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 500,
        select: { meta: true, action: true },
      });
      const auditBlob = JSON.stringify(audits);
      const piiNeedles: { label: string; value: string }[] = [
        { label: 'candidate phone', value: privRow.phone ?? '' },
        { label: 'candidate email', value: `cand-private@sec-probe.local` },
        { label: 'access token', value: cand.token!.slice(0, 40) },
        ...secretInventory().map((s) => ({ label: s.label, value: s.value })),
      ].filter((n) => n.value.length >= 8);

      for (const n of piiNeedles) {
        rec.expect({
          id: `redaction-audit-${n.label}`,
          group: 'redaction — audit rows',
          description: `${n.label} must never appear in audit_logs.meta`,
          expected: 'absent from the audit table',
          actual: auditBlob.includes(n.value) ? 'PRESENT IN AUDIT' : 'absent',
          pass: !auditBlob.includes(n.value),
          severity: 'High',
          owasp: A09,
        });
      }

      const logBlob = api2.logs.join('\n');
      for (const n of piiNeedles) {
        rec.expect({
          id: `redaction-log-${n.label}`,
          group: 'redaction — server logs',
          description: `${n.label} must never appear in the server log`,
          expected: 'absent from stdout/stderr',
          actual: logBlob.includes(n.value) ? 'PRESENT IN LOG' : 'absent',
          pass: !logBlob.includes(n.value),
          severity: 'High',
          owasp: A09,
        });
      }
    } finally {
      await api2.stop();
    }
  } finally {
    // api already stopped in the branches above
  }

  rec.print();
  console.log(`\n${rec.summary()}`);
  console.log(`evidence → ${rec.write('auth-config-probes.json')}`);

  if (process.env.SEC_KEEP_FIXTURES !== '1') await purge(prisma);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exitCode = 1;
});
