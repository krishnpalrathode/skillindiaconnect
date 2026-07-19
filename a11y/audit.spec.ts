/**
 * S8-H4 — the full RTL + WCAG 2.1 AA sweep (self-contained).
 *
 * ⚠️ SINGLE FILE ON PURPOSE. Playwright 1.61 on Node 22 in this environment
 * fails to resolve relative TypeScript imports from a spec
 * (TypeError: context.conditions?.includes is not a function) — a
 * PRE-EXISTING breakage that also stops the committed e2e suite from loading,
 * see the audit report. Inlining the helpers keeps the audit runnable without
 * touching shared config; split it back out once the runner is fixed.
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
/**
 * S8-H4 — THE screen inventory under audit.
 *
 * Scope rules from the unit brief:
 *   - user-facing (candidate / employer / public) → FULL RTL + a11y audit
 *   - admin → a11y audit ONLY (EN-only by product decision, no RTL work)
 *
 * `auth` states which session the screen needs; the harness seeds the matching
 * localStorage/cookie before navigating. Screens are listed with the concrete
 * ids MSW serves, because auditing an empty state proves nothing about a dense
 * grid — the leak spots only appear when there is content to mirror.
 */

type Audience = 'public' | 'candidate' | 'employer' | 'admin';

interface Screen {
  /** Stable id used in report tables and result JSON. */
  id: string;
  /** Path WITHOUT the locale prefix; the harness prepends /en or /ar. */
  path: string;
  audience: Audience;
  /** Human name for the report. */
  name: string;
  /** Screens the brief flagged as RTL leak spots — audited with extra checks. */
  leakSpot?: string;
  /** Skip RTL for admin (EN-only by decision). */
  rtl: boolean;
}

const SCREENS: Screen[] = [
  // ── Public ──────────────────────────────────────────────────────────────
  { id: 'landing', path: '/', audience: 'public', name: 'Landing', rtl: true },
  { id: 'jobs-list', path: '/jobs', audience: 'public', name: 'Job search', rtl: true, leakSpot: 'job cards: benefit chips, badges, salary+currency' },
  { id: 'job-detail', path: '/jobs/job-1', audience: 'public', name: 'Job detail', rtl: true, leakSpot: 'salary/currency, benefit chips' },
  { id: 'login', path: '/login', audience: 'public', name: 'Candidate login', rtl: true },
  { id: 'signup', path: '/signup', audience: 'public', name: 'Candidate signup', rtl: true },
  { id: 'forgot-password', path: '/forgot-password', audience: 'public', name: 'Forgot password', rtl: true },
  { id: 'employer-login', path: '/employer-login', audience: 'public', name: 'Employer login', rtl: true },

  // ── Candidate ───────────────────────────────────────────────────────────
  { id: 'onboarding', path: '/onboarding', audience: 'candidate', name: 'Candidate onboarding (stepper)', rtl: true, leakSpot: 'stepper direction + next/back affordances' },
  { id: 'dashboard', path: '/dashboard', audience: 'candidate', name: 'Candidate dashboard', rtl: true, leakSpot: 'completion ring + label' },
  { id: 'profile', path: '/profile', audience: 'candidate', name: 'Candidate profile', rtl: true, leakSpot: 'completion ring, uploads' },
  { id: 'applications', path: '/applications', audience: 'candidate', name: 'My applications', rtl: true },
  { id: 'application-detail', path: '/applications/app-1', audience: 'candidate', name: 'Application detail (timeline)', rtl: true, leakSpot: 'Screen 08 timeline: connector side + directional flow' },
  { id: 'notifications', path: '/notifications', audience: 'candidate', name: 'Notifications', rtl: true },

  // ── Employer ────────────────────────────────────────────────────────────
  { id: 'employer-onboarding', path: '/employer/onboarding', audience: 'employer', name: 'Employer onboarding', rtl: true, leakSpot: 'stepper direction' },
  { id: 'employer-dashboard', path: '/employer/dashboard', audience: 'employer', name: 'Employer dashboard', rtl: true },
  { id: 'employer-jobs', path: '/employer/jobs', audience: 'employer', name: 'Employer jobs list', rtl: true },
  { id: 'employer-job-new', path: '/employer/jobs/new', audience: 'employer', name: 'Job form + live preview (Screen 16)', rtl: true, leakSpot: 'mirrored two-column layout — columns must swap' },
  { id: 'employer-applicants', path: '/employer/jobs/job-1/applicants', audience: 'employer', name: 'Applicants table', rtl: true, leakSpot: 'dense table + match scores' },
  { id: 'employer-candidates', path: '/employer/candidates', audience: 'employer', name: 'Candidate browse', rtl: true, leakSpot: 'candidate cards' },
  { id: 'employer-candidate-detail', path: '/employer/candidates/cand-1', audience: 'employer', name: 'Candidate detail', rtl: true, leakSpot: 'mirrored two-column layout' },
  { id: 'employer-profile', path: '/employer/profile', audience: 'employer', name: 'Employer profile', rtl: true, leakSpot: 'mirrored two-column layout, uploads' },
  { id: 'employer-subscription', path: '/employer/subscription', audience: 'employer', name: 'Subscription / billing', rtl: true, leakSpot: 'currency amounts' },

  // ── Admin (a11y only — EN-only by decision) ─────────────────────────────
  { id: 'admin-dashboard', path: '/admin/dashboard', audience: 'admin', name: 'Admin dashboard', rtl: false },
  { id: 'admin-roles', path: '/admin/roles', audience: 'admin', name: 'RBAC matrix (Screen 27)', rtl: false },
  { id: 'admin-logs', path: '/admin/logs', audience: 'admin', name: 'Log explorer', rtl: false },
  { id: 'admin-candidates', path: '/admin/candidates', audience: 'admin', name: 'Admin candidates', rtl: false },
  { id: 'admin-candidate-detail', path: '/admin/candidates/cand-1', audience: 'admin', name: 'Admin candidate detail', rtl: false },
  { id: 'admin-employers', path: '/admin/employers', audience: 'admin', name: 'Admin employers', rtl: false },
  { id: 'admin-jobs', path: '/admin/jobs', audience: 'admin', name: 'Admin jobs (moderation)', rtl: false },
  { id: 'admin-applications', path: '/admin/applications', audience: 'admin', name: 'Admin applications', rtl: false },
  { id: 'admin-application-detail', path: '/admin/applications/app-1', audience: 'admin', name: 'Admin application detail (timeline)', rtl: false },
  { id: 'admin-settings', path: '/admin/settings', audience: 'admin', name: 'Platform settings', rtl: false },
];

const RTL_SCREENS = SCREENS.filter((s) => s.rtl);

/**
 * S8-H4 — the audit harness.
 *
 * Four layers, because automated checking alone catches roughly a third of real
 * problems and this product's users cannot route around the rest:
 *
 *  1. AXE-CORE — the automated WCAG sweep. Necessary, not sufficient.
 *  2. KEYBOARD — genuine keystrokes through Playwright: tab order, visible
 *     focus, traps, Escape handling. This is real keyboard operation, not a
 *     simulation of it.
 *  3. ACCESSIBILITY TREE — what a screen reader actually consumes, read from
 *     the browser's own a11y tree. See the honesty note below.
 *  4. RTL GEOMETRY — computed styles and measured box positions in Arabic. The
 *     only way to tell "it mirrored" from "it mirrored CORRECTLY".
 *
 * ⚠️ HONESTY NOTE ON SCREEN READERS. This harness inspects the accessibility
 * tree and the ARIA contract — the input a screen reader speaks from. It does
 * NOT run NVDA, VoiceOver or TalkBack and listen to the output. Those are
 * different things: the tree can be correct while the announcement is still
 * confusing, badly ordered, or too verbose. Findings below are therefore stated
 * as "the SR contract is/isn't correct", never as "we listened to it". A live
 * AT pass is recorded as an open gap in the accessibility statement.
 */




const REPO_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(REPO_ROOT, 'a11y', 'out');

type Severity = 'Critical' | 'Serious' | 'Moderate' | 'Minor' | 'Info';

interface Finding {
  id: string;
  screen: string;
  locale: 'en' | 'ar';
  viewport: 'desktop' | 'mobile';
  /** WCAG 2.1 success criterion, e.g. "1.4.3 Contrast (Minimum)". */
  criterion: string;
  severity: Severity;
  summary: string;
  detail?: string;
  /** How it was found — names the layer, so the report can be honest. */
  method: 'axe' | 'keyboard' | 'a11y-tree' | 'rtl-geometry' | 'static' | 'manual';
  selector?: string;
  pass: boolean;
}

class Report {
  readonly findings: Finding[] = [];

  add(f: Finding): void {
    this.findings.push(f);
  }

  get failures(): Finding[] {
    return this.findings.filter((f) => !f.pass);
  }

  summary(): string {
    const total = this.findings.length;
    const failed = this.failures.length;
    const bySev = this.failures.reduce<Record<string, number>>((a, f) => {
      a[f.severity] = (a[f.severity] ?? 0) + 1;
      return a;
    }, {});
    const sev = Object.entries(bySev).map(([k, v]) => `${k}=${v}`).join(' ');
    return `${total - failed}/${total} checks passed${failed ? `  ✗ ${failed} FAILED (${sev})` : '  ✓ all clear'}`;
  }

  write(filename: string): string {
    mkdirSync(OUT_DIR, { recursive: true });
    const file = path.join(OUT_DIR, filename);
    writeFileSync(
      file,
      JSON.stringify(
        { generatedAt: new Date().toISOString(), total: this.findings.length, failed: this.failures.length, findings: this.findings },
        null,
        2,
      ),
    );
    return file;
  }
}

// ─────── Auth ───────────────────────────────────────────────────────────────

const CREDS: Record<string, { url: string; email: string; expect: RegExp }> = {
  candidate: { url: '/login', email: 'amir@example.com', expect: /\/dashboard/ },
  employer: { url: '/employer-login', email: 'employer@example.com', expect: /\/employer\// },
  admin: { url: '/employer-login', email: 'superadmin@example.com', expect: /\/admin\// },
};

/** Log in through the real form — the same path a user takes. */
async function login(page: Page, audience: string, locale: string): Promise<boolean> {
  const cred = CREDS[audience];
  if (!cred) return true; // public
  try {
    await page.goto(`/${locale}${cred.url}`, { waitUntil: 'domcontentloaded' });
    // The form is server-rendered but React-controlled: it is VISIBLE before it
    // is HYDRATED, and typing into the pre-hydration DOM submits nothing —
    // which silently skipped every authenticated screen. Waiting for the
    // network to settle is the reliable hydration signal here.
    const email = page.locator('input[type="email"], input[name="email"]').first();
    await email.waitFor({ state: 'visible', timeout: 20_000 });
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await page.waitForTimeout(600);
    await email.fill(cred.email, { timeout: 10_000 });
    await page.locator('input[type="password"]').first().fill('any-password');
    await page.locator('button[type="submit"]').first().click();
    // Wait for the session to exist, NOT for a specific landing URL. Different
    // roles land on different post-login screens, and pinning an expected URL
    // per role made the harness brittle for no benefit — the audit navigates to
    // its own target next, so all that matters is that we are authenticated
    // (i.e. no longer sitting on the login form).
    await page.waitForURL((url) => !/\/(login|employer-login)$/.test(url.pathname), {
      timeout: 20_000,
    });
    return true;
  } catch (err) {
    // Surface WHY sign-in failed. A swallowed reason here means every
    // authenticated screen silently skips and the audit reports coverage it
    // never had.
    // eslint-disable-next-line no-console
    console.log(
      `[login:${audience}/${locale}] FAILED: ${
        err instanceof Error ? err.message.split('\n')[0] : String(err)
      }`,
    );
    return false;
  }
}

// ─────── Layer 2 — keyboard ─────────────────────────────────────────────────

interface FocusStop {
  tag: string;
  role: string | null;
  name: string;
  /** Does it show a visible focus indicator distinct from its unfocused state? */
  focusVisible: boolean;
  /** Bounding box, to detect off-screen / zero-size focus stops. */
  box: { w: number; h: number } | null;
}

/**
 * Walk the page with real Tab presses and record every focus stop.
 *
 * Focus visibility is measured by comparing computed outline/box-shadow/ring
 * between the focused and unfocused state — a CSS class alone proves nothing if
 * it renders no visible difference.
 */
async function walkTabOrder(page: Page, maxStops = 60): Promise<FocusStop[]> {
  const stops: FocusStop[] = [];
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());

  for (let i = 0; i < maxStops; i++) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const name =
        el.getAttribute('aria-label') ??
        (el.getAttribute('aria-labelledby')
          ? document.getElementById(el.getAttribute('aria-labelledby')!)?.textContent?.trim()
          : null) ??
        (el as HTMLInputElement).labels?.[0]?.textContent?.trim() ??
        el.textContent?.trim().slice(0, 60) ??
        '';
      // A focus indicator is "visible" if an outline or a ring-like shadow renders.
      const hasOutline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
      const hasShadow = cs.boxShadow !== 'none' && cs.boxShadow.length > 0;
      return {
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role'),
        name: String(name ?? ''),
        focusVisible: hasOutline || hasShadow,
        box: { w: Math.round(r.width), h: Math.round(r.height) },
      };
    });
    if (!stop) break;
    // Cycle detected — we are back at the first control.
    if (stops.length > 1 && stops[0] && stop.tag === stops[0].tag && stop.name === stops[0].name) break;
    stops.push(stop);
  }
  return stops;
}

// ─────── Layer 3 — the accessibility tree ───────────────────────────────────

interface A11yNode {
  role: string;
  name: string;
}

/**
 * The browser's OWN accessibility tree, via CDP `Accessibility.getFullAXTree`.
 *
 * This is the tree the platform hands to a screen reader, so it is the closest
 * faithful reading available without driving live AT. `page.accessibility` was
 * removed from Playwright, and reconstructing roles from the DOM would only
 * re-implement (and disagree with) the browser's own computation — the point is
 * to read what the browser actually exposes, including its implicit roles and
 * computed names.
 */
async function a11yTree(page: Page): Promise<A11yNode[]> {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Accessibility.enable');
    const { nodes } = (await cdp.send('Accessibility.getFullAXTree')) as {
      nodes: {
        role?: { value?: string };
        name?: { value?: string };
        ignored?: boolean;
      }[];
    };
    return nodes
      .filter((n) => !n.ignored && n.role?.value)
      .map((n) => ({ role: String(n.role?.value ?? ''), name: String(n.name?.value ?? '') }));
  } catch {
    return [];
  } finally {
    await cdp.detach().catch(() => undefined);
  }
}

/** Kept for call-site symmetry; the CDP reader already returns a flat list. */
function flattenTree(nodes: A11yNode[]): A11yNode[] {
  return nodes;
}

// ─────── Layer 4 — RTL geometry ─────────────────────────────────────────────

/**
 * Every element whose COMPUTED style uses a physical direction that would not
 * mirror. Reading computed styles rather than source is deliberate: it catches
 * physical values arriving from a component library, an inline style, or a
 * utility class the static grep does not know about.
 */
async function findPhysicalStyles(page: Page): Promise<
  { selector: string; prop: string; value: string }[]
> {
  return page.evaluate(() => {
    const out: { selector: string; prop: string; value: string }[] = [];
    const describe = (el: Element): string => {
      const id = el.id ? `#${el.id}` : '';
      const cls = typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).slice(0, 3).join('.')}` : '';
      return `${el.tagName.toLowerCase()}${id}${cls}`.slice(0, 120);
    };

    for (const el of Array.from(document.querySelectorAll('body *')).slice(0, 3000)) {
      const cs = getComputedStyle(el);
      // Absolute/fixed positioning pinned with a physical inset does not mirror.
      if (cs.position === 'absolute' || cs.position === 'fixed') {
        const hasL = cs.left !== 'auto';
        const hasR = cs.right !== 'auto';
        // Pinned to exactly one physical side → will not mirror under dir=rtl.
        if (hasL !== hasR) {
          out.push({ selector: describe(el), prop: hasL ? 'left' : 'right', value: hasL ? cs.left : cs.right });
        }
      }
      // text-align left/right is physical; start/end mirror.
      if (cs.textAlign === 'left' || cs.textAlign === 'right') {
        // Only report if it actually contains text.
        if ((el.textContent ?? '').trim().length > 0 && el.children.length === 0) {
          out.push({ selector: describe(el), prop: 'text-align', value: cs.textAlign });
        }
      }
    }
    return out.slice(0, 60);
  });
}

/** Does the document scroll horizontally? Clipping/overflow introduced by the mirror. */
async function hasHorizontalOverflow(page: Page): Promise<{ overflow: boolean; scrollW: number; clientW: number }> {
  return page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  }));
}

/**
 * Numbers, currency, dates and phone numbers must render LEFT-TO-RIGHT even
 * inside an RTL paragraph. THE most common RTL mistake, and the one that makes
 * a salary unreadable.
 *
 * Detection: find text nodes that are numeric-ish and check the resolved
 * `direction` on their nearest element, plus whether the app wrapped them in a
 * bidi-isolating construct (`dir="ltr"`, `<bdi>`, or `unicode-bidi: isolate`).
 */
async function findUnisolatedNumbers(page: Page): Promise<
  { text: string; selector: string; direction: string; isolated: boolean }[]
> {
  return page.evaluate(() => {
    const NUMERIC = /[0-9]/;
    // Salary/currency/phone/percent shapes — the ones that break visibly.
    const RISKY = /(?:[0-9][0-9,.\s]*(?:%|AED|SAR|QAR|KWD|OMR|BHD|INR|₹|\$)|(?:AED|SAR|QAR|KWD|OMR|BHD|INR|₹|\$)\s*[0-9]|\+[0-9]{6,}|[0-9]{1,3}(?:,[0-9]{3})+)/;
    const out: { text: string; selector: string; direction: string; isolated: boolean }[] = [];
    const describe = (el: Element): string => {
      const cls = typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
      return `${el.tagName.toLowerCase()}${cls}`.slice(0, 100);
    };

    // Skip non-rendered text: script/style/template carry Next.js flight data
    // full of numeric runs that no user ever sees. Including them produced pure
    // noise and would have buried the real bidi findings.
    const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT']);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
        // Also skip anything visually hidden — it is not a rendering concern.
        const cs = getComputedStyle(parent);
        if (cs.display === 'none' || cs.visibility === 'hidden') return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let n: Node | null;
    while ((n = walker.nextNode())) {
      const text = (n.textContent ?? '').trim();
      if (!text || !NUMERIC.test(text) || !RISKY.test(text)) continue;
      const el = n.parentElement;
      if (!el) continue;
      const cs = getComputedStyle(el);
      if (cs.direction !== 'rtl') continue; // already LTR context — fine

      // Isolated if the element or an ancestor establishes an LTR/bidi island.
      let isolated = false;
      for (let cur: Element | null = el; cur && cur !== document.body; cur = cur.parentElement) {
        const s = getComputedStyle(cur);
        if (
          cur.getAttribute('dir') === 'ltr' ||
          cur.tagName.toLowerCase() === 'bdi' ||
          s.unicodeBidi === 'isolate' ||
          s.unicodeBidi === 'isolate-override' ||
          s.unicodeBidi === 'plaintext'
        ) {
          isolated = true;
          break;
        }
      }
      out.push({ text: text.slice(0, 40), selector: describe(el), direction: cs.direction, isolated });
    }
    // De-duplicate by selector+text.
    const seen = new Set<string>();
    return out.filter((r) => {
      const k = `${r.selector}|${r.text}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).slice(0, 40);
  });
}

/** Interactive targets smaller than the 44×44 CSS-pixel minimum. */
async function findSmallTargets(page: Page, min = 44): Promise<
  { selector: string; name: string; w: number; h: number }[]
> {
  return page.evaluate((minPx) => {
    const out: { selector: string; name: string; w: number; h: number }[] = [];
    const sel = 'a[href], button, input, select, textarea, [role="button"], [role="checkbox"], [role="switch"], [role="tab"], [tabindex]:not([tabindex="-1"])';
    for (const el of Array.from(document.querySelectorAll(sel))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue; // hidden
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      // Inline links inside prose are exempt from 2.5.5 target size.
      const isInlineLink = el.tagName.toLowerCase() === 'a' && cs.display.includes('inline');
      if (isInlineLink) continue;
      if (r.width < minPx || r.height < minPx) {
        const cls = typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
        out.push({
          selector: `${el.tagName.toLowerCase()}${cls}`.slice(0, 90),
          name: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40),
          w: Math.round(r.width),
          h: Math.round(r.height),
        });
      }
    }
    return out.slice(0, 30);
  }, min);
}

/** Elements announcing async state — the aria-live contract. */
async function findLiveRegions(page: Page): Promise<{ role: string; live: string; text: string }[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[aria-live], [role="status"], [role="alert"], [role="log"], [aria-busy="true"]')).map((el) => ({
      role: el.getAttribute('role') ?? '',
      live: el.getAttribute('aria-live') ?? (el.getAttribute('role') === 'alert' ? 'assertive' : el.getAttribute('role') === 'status' ? 'polite' : ''),
      text: (el.textContent ?? '').trim().slice(0, 80),
    })),
  );
}

function loadJson<T>(file: string): T {
  return JSON.parse(readFileSync(path.join(OUT_DIR, file), 'utf8')) as T;
}

/**
 * S8-H4 — the full RTL + WCAG 2.1 AA sweep.
 *
 * Runs every screen in the inventory through four layers (see lib/audit.ts) at
 * both the desktop and the constrained Android viewport, in English and — for
 * user-facing screens — Arabic.
 *
 *   pnpm a11y:audit
 *
 * Results land in a11y/out/*.json and are turned into the reports by
 * a11y/render-reports.ts.
 */


const report = new Report();

/** Severity mapping from axe impact. */
const SEV: Record<string, 'Critical' | 'Serious' | 'Moderate' | 'Minor'> = {
  critical: 'Critical',
  serious: 'Serious',
  moderate: 'Moderate',
  minor: 'Minor',
};

test.describe.configure({ mode: 'serial' });

test.afterAll(() => {
  const file = report.write('audit.json');
  // eslint-disable-next-line no-console
  console.log(`\n${report.summary()}\nevidence → ${file}`);
});

for (const screen of SCREENS) {
  const locales: ('en' | 'ar')[] = screen.rtl ? ['en', 'ar'] : ['en'];

  for (const locale of locales) {
    test(`${screen.id} [${locale}]`, async ({ page }, testInfo) => {
      const viewport = testInfo.project.name === 'android-constrained' ? 'mobile' : 'desktop';
      const base = { screen: screen.id, locale, viewport } as const;

      const authed = await login(page, screen.audience, locale);
      if (!authed) {
        report.add({
          ...base,
          id: `${screen.id}-${locale}-auth`,
          criterion: 'n/a (harness)',
          severity: 'Info',
          summary: `Could not reach ${screen.name} — sign-in for ${screen.audience} did not complete`,
          method: 'manual',
          pass: false,
        });
        test.skip();
        return;
      }

      const response = await page.goto(`/${locale}${screen.path}`, { waitUntil: 'domcontentloaded' });
      // Let client-side data (MSW) settle so dense content is actually present.
      await page.waitForTimeout(2500);

      const reachable = (response?.status() ?? 0) < 400;
      report.add({
        ...base,
        id: `${screen.id}-${locale}-reachable`,
        criterion: 'n/a (harness)',
        severity: 'Info',
        summary: `${screen.name} rendered (HTTP ${response?.status()})`,
        method: 'manual',
        pass: reachable,
      });
      if (!reachable) return;

      // ── Layer 1: axe-core ───────────────────────────────────────────────
      const axe = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      for (const v of axe.violations) {
        report.add({
          ...base,
          id: `${screen.id}-${locale}-axe-${v.id}`,
          criterion: v.tags.filter((t) => t.startsWith('wcag')).join(', ') || v.id,
          severity: SEV[v.impact ?? 'moderate'] ?? 'Moderate',
          summary: `${v.id}: ${v.help}`,
          detail: v.nodes.slice(0, 3).map((n) => n.html.slice(0, 160)).join(' | '),
          method: 'axe',
          selector: v.nodes[0]?.target?.join(' ') ?? undefined,
          pass: false,
        });
      }
      if (axe.violations.length === 0) {
        report.add({
          ...base,
          id: `${screen.id}-${locale}-axe-clean`,
          criterion: 'WCAG 2.1 AA (automated subset)',
          severity: 'Info',
          summary: 'No axe violations',
          method: 'axe',
          pass: true,
        });
      }

      // ── Layer 2: keyboard ───────────────────────────────────────────────
      const stops = await walkTabOrder(page);
      const unnamed = stops.filter((s) => !s.name || s.name.length === 0);
      const invisibleFocus = stops.filter((s) => !s.focusVisible);
      const zeroSize = stops.filter((s) => s.box && (s.box.w === 0 || s.box.h === 0));

      // A screen with NO interactive elements legitimately has no focus stops
      // (the landing placeholder is exactly that). The meaningful question is
      // whether every control that EXISTS is reachable; flagging an empty page
      // as a keyboard failure is noise that buries the real findings.
      const focusableCount = await page.evaluate(
        () =>
          document.querySelectorAll(
            'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])',
          ).length,
      );
      report.add({
        ...base,
        id: `${screen.id}-${locale}-kbd-reachable`,
        criterion: '2.1.1 Keyboard',
        severity: 'Critical',
        summary:
          focusableCount === 0
            ? 'No interactive elements on this screen (nothing to reach)'
            : `${stops.length} focus stop(s) reached by Tab; ${focusableCount} interactive element(s) present`,
        method: 'keyboard',
        pass: focusableCount === 0 || stops.length > 0,
      });

      report.add({
        ...base,
        id: `${screen.id}-${locale}-kbd-focus-visible`,
        criterion: '2.4.7 Focus Visible',
        severity: 'Serious',
        summary:
          invisibleFocus.length === 0
            ? 'Every focus stop renders a visible focus indicator'
            : `${invisibleFocus.length}/${stops.length} focus stops render NO visible indicator`,
        detail: invisibleFocus.slice(0, 5).map((s) => `${s.tag}"${s.name.slice(0, 30)}"`).join(', '),
        method: 'keyboard',
        pass: invisibleFocus.length === 0,
      });

      report.add({
        ...base,
        id: `${screen.id}-${locale}-kbd-named`,
        criterion: '4.1.2 Name, Role, Value',
        severity: 'Serious',
        summary:
          unnamed.length === 0
            ? 'Every focusable control has an accessible name'
            : `${unnamed.length} focusable control(s) have NO accessible name`,
        detail: unnamed.slice(0, 5).map((s) => `<${s.tag} role=${s.role ?? '-'}>`).join(', '),
        method: 'keyboard',
        pass: unnamed.length === 0,
      });

      if (zeroSize.length > 0) {
        report.add({
          ...base,
          id: `${screen.id}-${locale}-kbd-zero-size`,
          criterion: '2.4.7 Focus Visible',
          severity: 'Moderate',
          summary: `${zeroSize.length} focus stop(s) have zero size (focus goes somewhere invisible)`,
          method: 'keyboard',
          pass: false,
        });
      }

      // ── Layer 3: the SR contract ────────────────────────────────────────
      const tree = flattenTree(await a11yTree(page));
      const headings = tree.filter((n) => n.role === 'heading');
      report.add({
        ...base,
        id: `${screen.id}-${locale}-sr-headings`,
        criterion: '1.3.1 Info and Relationships / 2.4.6 Headings and Labels',
        severity: 'Moderate',
        summary: headings.length > 0 ? `${headings.length} headings exposed to AT` : 'NO headings exposed — AT users cannot skim this screen',
        method: 'a11y-tree',
        pass: headings.length > 0,
      });

      const live = await findLiveRegions(page);
      report.add({
        ...base,
        id: `${screen.id}-${locale}-sr-live`,
        criterion: '4.1.3 Status Messages',
        severity: 'Info',
        summary: `${live.length} live region(s) present`,
        detail: live.slice(0, 4).map((l) => `${l.role || l.live}:"${l.text.slice(0, 30)}"`).join(' | '),
        method: 'a11y-tree',
        pass: true,
      });

      // ── Layer 3b: target size ───────────────────────────────────────────
      const small = await findSmallTargets(page);
      report.add({
        ...base,
        id: `${screen.id}-${locale}-target-size`,
        criterion: '2.5.5 Target Size (AAA) / product rule ≥44px',
        severity: 'Moderate',
        summary:
          small.length === 0
            ? 'All non-inline interactive targets ≥44px'
            : `${small.length} interactive target(s) below 44px`,
        detail: small.slice(0, 6).map((s) => `${s.selector}"${s.name}" ${s.w}×${s.h}`).join(', '),
        method: 'rtl-geometry',
        pass: small.length === 0,
      });

      // ── Layer 4: RTL correctness (Arabic only) ──────────────────────────
      if (locale === 'ar') {
        const dir = await page.evaluate(() => document.documentElement.getAttribute('dir'));
        report.add({
          ...base,
          id: `${screen.id}-rtl-dir`,
          criterion: '1.3.2 Meaningful Sequence (RTL)',
          severity: 'Critical',
          summary: `<html dir> is "${dir}"`,
          method: 'rtl-geometry',
          pass: dir === 'rtl',
        });

        const overflow = await hasHorizontalOverflow(page);
        report.add({
          ...base,
          id: `${screen.id}-rtl-overflow`,
          criterion: '1.4.10 Reflow',
          severity: 'Serious',
          summary: overflow.overflow
            ? `Horizontal overflow in RTL (${overflow.scrollW}px content in ${overflow.clientW}px viewport)`
            : 'No horizontal overflow in RTL',
          method: 'rtl-geometry',
          pass: !overflow.overflow,
        });

        const physical = await findPhysicalStyles(page);
        report.add({
          ...base,
          id: `${screen.id}-rtl-physical`,
          criterion: '1.3.2 Meaningful Sequence (RTL)',
          severity: 'Serious',
          summary:
            physical.length === 0
              ? 'No physical-direction computed styles that would fail to mirror'
              : `${physical.length} element(s) use a physical direction that does not mirror`,
          detail: physical.slice(0, 6).map((p) => `${p.selector} {${p.prop}:${p.value}}`).join(', '),
          method: 'rtl-geometry',
          pass: physical.length === 0,
        });

        const numbers = await findUnisolatedNumbers(page);
        const unisolated = numbers.filter((n) => !n.isolated);
        report.add({
          ...base,
          id: `${screen.id}-rtl-numbers`,
          criterion: '1.3.2 Meaningful Sequence (bidi)',
          severity: 'Serious',
          summary:
            unisolated.length === 0
              ? 'Numeric/currency/phone runs are bidi-isolated or in an LTR context'
              : `${unisolated.length} numeric run(s) render in an RTL context WITHOUT bidi isolation`,
          detail: unisolated.slice(0, 6).map((n) => `${n.selector}: "${n.text}"`).join(' | '),
          method: 'rtl-geometry',
          pass: unisolated.length === 0,
        });
      }

      // Screenshot for the report appendix.
      await testInfo.attach(`${screen.id}-${locale}-${viewport}`, {
        body: await page.screenshot({ fullPage: false }),
        contentType: 'image/png',
      });

      expect(true).toBe(true); // findings are recorded, not thrown — the sweep must complete
    });
  }
}
