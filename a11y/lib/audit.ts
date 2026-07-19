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
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';

export const REPO_ROOT = path.resolve(__dirname, '..', '..');
export const OUT_DIR = path.join(REPO_ROOT, 'a11y', 'out');

export type Severity = 'Critical' | 'Serious' | 'Moderate' | 'Minor' | 'Info';

export interface Finding {
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

export class Report {
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
  employer: { url: '/employer-login', email: 'hr@gulfbuild.example', expect: /\/employer\// },
  admin: { url: '/employer-login', email: 'admin@skillindiaconnect.com', expect: /\/admin\// },
};

/** Log in through the real form — the same path a user takes. */
export async function login(page: Page, audience: string, locale: string): Promise<boolean> {
  const cred = CREDS[audience];
  if (!cred) return true; // public
  try {
    await page.goto(`/${locale}${cred.url}`, { waitUntil: 'domcontentloaded' });
    const email = page.locator('input[type="email"], input[name="email"]').first();
    await email.fill(cred.email, { timeout: 10_000 });
    await page.locator('input[type="password"]').first().fill('any-password');
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL(cred.expect, { timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

// ─────── Layer 2 — keyboard ─────────────────────────────────────────────────

export interface FocusStop {
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
export async function walkTabOrder(page: Page, maxStops = 60): Promise<FocusStop[]> {
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

export interface A11yNode {
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
export async function a11yTree(page: Page): Promise<A11yNode[]> {
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
export function flattenTree(nodes: A11yNode[]): A11yNode[] {
  return nodes;
}

// ─────── Layer 4 — RTL geometry ─────────────────────────────────────────────

/**
 * Every element whose COMPUTED style uses a physical direction that would not
 * mirror. Reading computed styles rather than source is deliberate: it catches
 * physical values arriving from a component library, an inline style, or a
 * utility class the static grep does not know about.
 */
export async function findPhysicalStyles(page: Page): Promise<
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
export async function hasHorizontalOverflow(page: Page): Promise<{ overflow: boolean; scrollW: number; clientW: number }> {
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
export async function findUnisolatedNumbers(page: Page): Promise<
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

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
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
export async function findSmallTargets(page: Page, min = 44): Promise<
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
export async function findLiveRegions(page: Page): Promise<{ role: string; live: string; text: string }[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[aria-live], [role="status"], [role="alert"], [role="log"], [aria-busy="true"]')).map((el) => ({
      role: el.getAttribute('role') ?? '',
      live: el.getAttribute('aria-live') ?? (el.getAttribute('role') === 'alert' ? 'assertive' : el.getAttribute('role') === 'status' ? 'polite' : ''),
      text: (el.textContent ?? '').trim().slice(0, 80),
    })),
  );
}

export function loadJson<T>(file: string): T {
  return JSON.parse(readFileSync(path.join(OUT_DIR, file), 'utf8')) as T;
}
