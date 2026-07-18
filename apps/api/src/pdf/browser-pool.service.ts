import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Browser, PDFOptions } from 'puppeteer';

/**
 * puppeteer ≥22 ships ESM-only. This file compiles to CommonJS (Nest), where
 * TS would lower `import()` to `require()` — which cannot load ESM under
 * jest's runtime. `new Function` keeps a NATIVE dynamic import that Node
 * resolves itself in every environment (dev ts-node, compiled dist, jest).
 * The type-side imports above are erased at compile time.
 */
const importPuppeteer = new Function(
  'return import("puppeteer")',
) as () => Promise<typeof import('puppeteer')>;

/**
 * THE bounded Chromium pool (S7-B1) — WORKER PROCESS ONLY. The API never
 * imports this module; it enqueues render jobs and the worker consumes them
 * (worker-and-external-sends.md). ⚠️ CODEOWNERS second review: an unbounded
 * pool is how a worker OOMs in production.
 *
 * The memory ceiling, stated:
 *
 * - **Concurrency = 2** (MAX_CONCURRENT_RENDERS). The worker container runs
 *   at 512MB–1GB; the shared browser costs ~150MB and each active page
 *   ~50–120MB, so two parallel renders bound peak Chromium footprint at
 *   roughly 150 + 2×120 ≈ 400MB with Node headroom left. This cap is shared
 *   by BOTH processors (resume + invoice) — BullMQ may hold more jobs, but
 *   renders beyond 2 WAIT for a slot here; they never spawn more browsers.
 * - **One shared browser, fresh page per render.** Launch is expensive (~1s);
 *   pages are cheap and disposable. Every page is closed in a `finally` —
 *   a leaked page is a leaked slot AND leaked memory.
 * - **Per-render timeout = 30s** (RENDER_TIMEOUT_MS). A healthy render is
 *   under ~3s; at 30s the page is genuinely wedged — it is force-closed and
 *   the slot reclaimed, and the caller gets a clean error (BullMQ retries).
 * - **Recycle after 50 renders** (RECYCLE_AFTER_RENDERS). Even with disciplined
 *   page closing, long-lived Chromium accumulates memory; the shared browser
 *   is closed and relaunched once the counter passes 50 AND no render is in
 *   flight, capping leak growth without interrupting work.
 * - **Crash recovery.** `disconnected` marks the instance dead; in-flight
 *   renders fail cleanly (their pages died with the browser) and the NEXT
 *   acquire relaunches. The pool never wedges on a dead browser.
 * - **Graceful shutdown.** `onModuleDestroy` (fired by the worker's SIGTERM →
 *   app.close()) closes the browser so a Railway redeploy leaves no zombie
 *   Chromium.
 *
 * Launch flags, stated:
 *   --no-sandbox --disable-setuid-sandbox  containers run as a non-root user
 *                                          without the user namespaces the
 *                                          sandbox needs; content is OUR OWN
 *                                          templates, never third-party pages
 *   --disable-dev-shm-usage                Docker's /dev/shm defaults to 64MB;
 *                                          Chromium crashes when it fills —
 *                                          this writes shm to /tmp instead
 *   --disable-gpu                          headless server, no GPU; avoids GL
 *                                          init cost and driver surprises
 *   --disable-extensions --no-first-run
 *   --no-default-browser-check             startup cost/noise off
 *   --font-render-hinting=none             deterministic text metrics across
 *                                          environments (stable PDF layout)
 *
 * Logs carry durations and counters ONLY — never HTML content (it contains
 * candidate PII).
 */
const MAX_CONCURRENT_RENDERS = 2;
const RENDER_TIMEOUT_MS = 30_000;
const RECYCLE_AFTER_RENDERS = 50;

const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-extensions',
  '--no-first-run',
  '--no-default-browser-check',
  '--font-render-hinting=none',
];

@Injectable()
export class BrowserPoolService implements OnModuleDestroy {
  private readonly logger = new Logger(BrowserPoolService.name);

  private browser: Browser | null = null;
  private launching: Promise<Browser> | null = null;
  private rendersSinceLaunch = 0;
  private activeRenders = 0;
  private readonly waiters: Array<() => void> = [];
  private shuttingDown = false;
  /** Instance-level so the timeout test can shrink the budget; 30s in production. */
  renderTimeoutMs = RENDER_TIMEOUT_MS;

  // Exposed for the pool tests: the cap must be observable to be provable.
  get activeCount(): number {
    return this.activeRenders;
  }
  get maxConcurrency(): number {
    return MAX_CONCURRENT_RENDERS;
  }

  constructor(private readonly config: ConfigService) {}

  /**
   * html → PDF buffer. Acquires a slot (waiting if at capacity), opens a
   * FRESH page, renders, and ALWAYS closes the page in `finally`.
   */
  async render(html: string, pdfOptions: PDFOptions = {}): Promise<Buffer> {
    if (this.shuttingDown) throw new Error('browser pool is shutting down');
    await this.acquireSlot();
    const started = Date.now();
    try {
      const buffer = await this.withTimeout(this.renderOnPage(html, pdfOptions));
      this.logger.log(
        `render ok in ${Date.now() - started}ms (active=${this.activeRenders}, sinceLaunch=${this.rendersSinceLaunch})`,
      );
      return buffer;
    } catch (err) {
      if (err instanceof Error && /timed out/.test(err.message)) {
        // A wedged renderer (e.g. a busy-looping page) cannot be closed
        // politely — page.close() would hang right behind it. SIGKILL the
        // whole instance: the page dies with it, the slot is reclaimed below,
        // and the next render relaunches lazily.
        this.forceKillBrowser('render timeout');
      }
      throw err;
    } finally {
      this.releaseSlot();
      // Recycle OUTSIDE the render path: only when idle, so no render is
      // interrupted and the next one pays the relaunch cost instead.
      if (this.rendersSinceLaunch >= RECYCLE_AFTER_RENDERS && this.activeRenders === 0) {
        await this.recycle();
      }
    }
  }

  private async renderOnPage(html: string, pdfOptions: PDFOptions): Promise<Buffer> {
    const browser = await this.getBrowser();
    this.rendersSinceLaunch += 1;
    // A FRESH page per render — never reused, always closed.
    const page = await browser.newPage();
    try {
      // 'load' (not networkidle0): templates are fully inlined (styles, fonts,
      // data-URI images), so there is nothing to wait for on the network and
      // nothing that can hang the wait. The outer timeout reaps pathological
      // cases regardless.
      await page.setContent(html, { waitUntil: 'load', timeout: this.renderTimeoutMs });
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        preferCSSPageSize: false,
        ...pdfOptions,
      });
      return Buffer.from(pdf);
    } finally {
      // The no-leak guarantee: close even on throw — but NEVER awaited
      // unboundedly: against a wedged renderer close() hangs forever (the
      // timeout path SIGKILLs the browser instead, taking the page with it).
      // 2s covers every healthy close.
      await this.boundedWait(page.close().catch(() => undefined), 2_000);
    }
  }

  /** Race `work` against a deadline, CLEARING the timer either way (no held handles). */
  private async boundedWait(work: Promise<unknown>, ms: number, onDeadline?: () => void): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        onDeadline?.();
        resolve();
      }, ms);
    });
    try {
      await Promise.race([work, deadline]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** The wedge-breaker: kill Chromium outright; lazy relaunch follows. */
  private forceKillBrowser(reason: string): void {
    const browser = this.browser;
    this.browser = null;
    this.rendersSinceLaunch = 0;
    if (browser) {
      this.logger.warn(`force-killing chromium (${reason})`);
      const proc = browser.process();
      if (proc) proc.kill('SIGKILL');
      else void browser.close().catch(() => undefined);
    }
  }

  private async withTimeout(work: Promise<Buffer>): Promise<Buffer> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`render timed out after ${this.renderTimeoutMs}ms`)),
        this.renderTimeoutMs,
      );
    });
    try {
      return await Promise.race([work, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // ── The bounded-slot semaphore ──────────────────────────────────────────────

  private async acquireSlot(): Promise<void> {
    if (this.activeRenders < MAX_CONCURRENT_RENDERS) {
      this.activeRenders += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.activeRenders += 1;
  }

  private releaseSlot(): void {
    this.activeRenders -= 1;
    const next = this.waiters.shift();
    if (next) next();
  }

  // ── Browser lifecycle: lazy launch, crash recovery, recycle, shutdown ───────

  private async getBrowser(): Promise<Browser> {
    if (this.browser?.connected) return this.browser;
    // Single-flight launch: concurrent renders during a (re)launch share it.
    if (!this.launching) {
      this.launching = this.launch().finally(() => {
        this.launching = null;
      });
    }
    return this.launching;
  }

  private async launch(): Promise<Browser> {
    const executablePath = this.config.get<string>('CHROMIUM_EXECUTABLE_PATH');
    const { default: puppeteer } = await importPuppeteer();
    const browser = await puppeteer.launch({
      headless: true,
      args: LAUNCH_ARGS,
      ...(executablePath ? { executablePath } : {}),
    });
    browser.on('disconnected', () => {
      // Crash detection: drop the dead instance so the NEXT acquire
      // relaunches. In-flight renders fail cleanly (their pages died) and
      // BullMQ retries them against the fresh instance.
      if (this.browser === browser) {
        this.browser = null;
        if (!this.shuttingDown) this.logger.warn('browser disconnected — will relaunch on demand');
      }
    });
    this.browser = browser;
    this.rendersSinceLaunch = 0;
    this.logger.log('chromium launched');
    return browser;
  }

  /** Close + drop the shared instance (idle-time recycle; relaunch is lazy). */
  private async recycle(): Promise<void> {
    const old = this.browser;
    this.browser = null;
    this.rendersSinceLaunch = 0;
    if (old) {
      this.logger.log(`recycling browser after ${RECYCLE_AFTER_RENDERS}+ renders`);
      await old.close().catch(() => undefined);
    }
  }

  /** SIGTERM → app.close() → here: no zombie Chromium across redeploys. */
  async onModuleDestroy(): Promise<void> {
    this.shuttingDown = true;
    const browser = this.browser;
    this.browser = null;
    if (browser) {
      // Polite close, bounded; a wedged instance gets the SIGKILL — a redeploy
      // must never hang on a stuck renderer.
      await this.boundedWait(browser.close().catch(() => undefined), 3_000, () =>
        browser.process()?.kill('SIGKILL'),
      );
    }
  }
}
