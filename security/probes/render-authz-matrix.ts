/**
 * S8-H2 — renders docs/authz-matrix.md from the sweep's machine output.
 *
 * The matrix is GENERATED, never hand-maintained: a hand-written table drifts
 * from the code the moment an endpoint is added, and a stale authorization
 * matrix is worse than none — it is a claim of coverage that no longer holds.
 *
 *   pnpm security:matrix     (run after pnpm security:authz)
 */
import './lib/env';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './lib/env';

interface Row {
  method: string;
  path: string;
  klass: string;
  permissions: string;
  role: string;
  expected: string;
  status: number;
  code: string | null;
  verdict: string;
}

const ROLE_ORDER = ['ANON', 'CANDIDATE', 'EMPLOYER', 'SUPPORT', 'MODERATOR', 'ADMIN', 'SUPER_ADMIN'];

function main() {
  const outDir = path.join(__dirname, 'out');
  const rows = JSON.parse(readFileSync(path.join(outDir, 'authz-matrix.json'), 'utf8')) as Row[];
  const sweep = JSON.parse(readFileSync(path.join(outDir, 'authz-sweep.json'), 'utf8')) as {
    total: number;
    failed: number;
    generatedAt: string;
  };

  // Group by endpoint, then one column per role.
  const byEndpoint = new Map<string, Row[]>();
  for (const r of rows) {
    const key = `${r.method} ${r.path}`;
    (byEndpoint.get(key) ?? byEndpoint.set(key, []).get(key)!).push(r);
  }

  const cell = (r: Row | undefined): string => {
    if (!r) return '—';
    const mark = r.verdict === 'OK' ? '' : ' ⚠️';
    return `${r.status}${r.code ? ` ${r.code}` : ''}${mark}`;
  };

  const sections: Record<string, string[]> = {
    'PUBLIC — no authentication required': [],
    'PERMISSION-GATED — the RBAC matrix decides': [],
    'AUTH-ONLY — authenticated; authorization is an ownership check in the service': [],
  };

  const sorted = [...byEndpoint.entries()].sort(([a], [b]) => a.localeCompare(b));
  for (const [endpoint, group] of sorted) {
    const first = group[0]!;
    const cells = ROLE_ORDER.map((role) => cell(group.find((g) => g.role === role)));
    const line = `| \`${endpoint}\` | ${first.permissions} | ${cells.join(' | ')} |`;
    const section =
      first.klass === 'PUBLIC'
        ? 'PUBLIC — no authentication required'
        : first.klass === 'PERMISSION-GATED'
          ? 'PERMISSION-GATED — the RBAC matrix decides'
          : 'AUTH-ONLY — authenticated; authorization is an ownership check in the service';
    sections[section]!.push(line);
  }

  const header = `| Endpoint | Required permission | ${ROLE_ORDER.join(' | ')} |`;
  const divider = `|---|---|${ROLE_ORDER.map(() => '---').join('|')}|`;

  const deviations = rows.filter((r) => r.verdict !== 'OK');

  const md = `# Authorization Matrix — endpoint × role

**Generated** from a live sweep of the compiled build — do not edit by hand.
Regenerate with \`pnpm security:authz && pnpm security:matrix\`.

- Sweep run: ${sweep.generatedAt}
- Endpoints: ${byEndpoint.size} · Principals: ${ROLE_ORDER.length} · Checks: ${sweep.total} · **Deviations: ${sweep.failed}**

Each cell is the **observed** HTTP status and error code for that role against
that endpoint. A ⚠️ marks a deviation from the expected authorization outcome.

## How to read this

- **PUBLIC** — reachable without a token. A credential-verifying route
  (\`/auth/login\`, \`/auth/refresh\`) answering 401 for bad credentials is
  correct: the *guard* did not reject it, the *credentials* did.
- **PERMISSION-GATED** — \`@RequirePermissions\`. A role that lacks the key MUST
  get 403; a role that holds it must pass the guard. The permission set is read
  from the live \`role_permissions\` table, so this reflects the deployed matrix.
- **AUTH-ONLY** — authenticated, no permission key. Authorization is the
  service's ownership check ("is this MY company / MY profile"). A 404 here for
  an admin role is CORRECT — an admin has no employer company, so the resource
  genuinely does not exist for them. Cross-tenant access on these routes is
  audited separately by the IDOR sweep, which is where ownership is actually
  proven.
- **404 vs 403** is a security distinction: 403 admits a resource exists; 404
  hides it. "Not yours / hidden" is always 404.

${Object.entries(sections)
  .filter(([, lines]) => lines.length > 0)
  .map(([title, lines]) => `## ${title}\n\n${header}\n${divider}\n${lines.join('\n')}`)
  .join('\n\n')}

## Deviations

${
  deviations.length === 0
    ? 'None. Every endpoint × role cell matched its expected authorization outcome.'
    : deviations
        .map((d) => `- \`${d.method} ${d.path}\` as **${d.role}** — expected ${d.expected}, got ${d.status} ${d.code ?? ''}`)
        .join('\n')
}
`;

  const docs = path.join(REPO_ROOT, 'docs');
  mkdirSync(docs, { recursive: true });
  const file = path.join(docs, 'authz-matrix.md');
  writeFileSync(file, md);
  console.log(`wrote ${path.relative(REPO_ROOT, file)} — ${byEndpoint.size} endpoints, ${sweep.failed} deviations`);
}

main();
