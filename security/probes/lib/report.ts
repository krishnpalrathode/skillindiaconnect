/**
 * S8-H2 — shared finding/result plumbing for the probe scripts.
 *
 * Every probe emits Checks. A Check that fails becomes a candidate FINDING; the
 * scripts print them and write JSON to security/probes/out/ so the audit report
 * cites machine-generated evidence rather than prose.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export type Severity = 'Critical' | 'High' | 'Medium' | 'Low' | 'Info';

export interface Check {
  /** Stable id, e.g. "IDOR-job-A-reads-B". */
  id: string;
  group: string;
  description: string;
  expected: string;
  actual: string;
  pass: boolean;
  severity: Severity;
  /** OWASP Top-10 2021 category, e.g. "A01:2021 Broken Access Control". */
  owasp?: string;
  /** Anything useful for reproduction. */
  detail?: Record<string, unknown>;
}

export class Recorder {
  readonly checks: Check[] = [];

  add(c: Check): Check {
    this.checks.push(c);
    return c;
  }

  /** Assert helper: pass/fail derived from a boolean. */
  expect(args: {
    id: string;
    group: string;
    description: string;
    expected: string;
    actual: string;
    pass: boolean;
    severity: Severity;
    owasp?: string;
    detail?: Record<string, unknown>;
  }): Check {
    return this.add(args);
  }

  get failures(): Check[] {
    return this.checks.filter((c) => !c.pass);
  }

  summary(): string {
    const total = this.checks.length;
    const failed = this.failures.length;
    const bySeverity = this.failures.reduce<Record<string, number>>((acc, f) => {
      acc[f.severity] = (acc[f.severity] ?? 0) + 1;
      return acc;
    }, {});
    const sev = Object.entries(bySeverity)
      .map(([k, v]) => `${k}=${v}`)
      .join(' ');
    return `${total - failed}/${total} checks passed${failed ? `  ✗ ${failed} FAILED  (${sev})` : '  ✓ all clear'}`;
  }

  print(groupFilter?: string): void {
    const groups = [...new Set(this.checks.map((c) => c.group))].filter(
      (g) => !groupFilter || g === groupFilter,
    );
    for (const g of groups) {
      const inGroup = this.checks.filter((c) => c.group === g);
      const bad = inGroup.filter((c) => !c.pass);
      console.log(`\n── ${g} — ${inGroup.length - bad.length}/${inGroup.length} passed ──`);
      for (const f of bad) {
        console.log(`  ✗ [${f.severity}] ${f.id}`);
        console.log(`      ${f.description}`);
        console.log(`      expected: ${f.expected}`);
        console.log(`      actual  : ${f.actual}`);
        if (f.detail) console.log(`      detail  : ${JSON.stringify(f.detail)}`);
      }
    }
  }

  write(filename: string): string {
    const outDir = path.join(__dirname, '..', 'out');
    mkdirSync(outDir, { recursive: true });
    const file = path.join(outDir, filename);
    writeFileSync(
      file,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          total: this.checks.length,
          failed: this.failures.length,
          checks: this.checks,
        },
        null,
        2,
      ),
    );
    return file;
  }
}
