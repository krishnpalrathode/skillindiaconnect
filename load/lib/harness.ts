/**
 * S8-H1 — shared load-harness helpers: percentiles, the worker child process,
 * the process-tree memory sampler, and JWT minting.
 */
import { ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';

// These scripts run under tsx in CommonJS mode (no "type": "module" in any
// package.json on the path), so __dirname is available. Anchoring on it rather
// than cwd matters: the pnpm --filter runner executes them from apps/api.
export const REPO_ROOT = path.resolve(__dirname, '..', '..');
export const API_DIST = path.join(REPO_ROOT, 'apps', 'api', 'dist');

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Load the repo-root `.env` into process.env — the same file the API and worker
 * read (core/config's ROOT_ENV_PATH). Existing env vars WIN, so a per-run
 * override on the command line is never clobbered. Hand-rolled rather than
 * pulling in dotenv: it is a transitive dep of @nestjs/config inside apps/api,
 * not resolvable from the workspace root.
 */
export function loadRootEnv(): void {
  const file = path.join(REPO_ROOT, '.env');
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

// ─────── Stats ───────────────────────────────────────────────────────────────

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)]!;
}

export interface LatencyStats {
  count: number;
  min: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
}

export function stats(values: number[]): LatencyStats {
  const s = [...values].sort((a, b) => a - b);
  return {
    count: s.length,
    min: s[0] ?? NaN,
    p50: percentile(s, 50),
    p95: percentile(s, 95),
    p99: percentile(s, 99),
    max: s[s.length - 1] ?? NaN,
    mean: s.length ? s.reduce((a, b) => a + b, 0) / s.length : NaN,
  };
}

export const mb = (bytes: number) => Math.round(bytes / 1024 / 1024);

// ─────── JWT minting ─────────────────────────────────────────────────────────

/**
 * Mint an access token directly instead of calling POST /auth/login.
 *
 * Deliberate: auth is rate-limited to 5/min/IP (api-conventions.md), so a load
 * script that logged in would measure the throttler, not the path under test.
 * The payload matches TokenService.issue() exactly — {sub, email, role, jti,
 * type:'access'}, HS256, JWT_ACCESS_SECRET.
 */
export function mintAccessToken(userId: string, email: string, role: string): string {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) throw new Error('JWT_ACCESS_SECRET is not set (load the repo-root .env)');
  return jwt.sign({ sub: userId, email, role, jti: randomUUID(), type: 'access' }, secret, {
    expiresIn: '2h',
  });
}

// ─────── Process-tree memory sampler ────────────────────────────────────────

export interface MemSample {
  t: number;
  totalBytes: number;
  procCount: number;
  chromiumBytes: number;
}

export class TreeMemorySampler {
  private proc: ChildProcess | null = null;
  readonly samples: MemSample[] = [];

  constructor(
    private readonly rootPid: number,
    private readonly intervalMs = 400,
  ) {}

  start(): void {
    const script = path.join(REPO_ROOT, 'load', 'lib', 'sample-tree-memory.ps1');
    this.proc = spawn(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script,
       '-RootPid', String(this.rootPid), '-IntervalMs', String(this.intervalMs)],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    );
    let buf = '';
    this.proc.stdout!.on('data', (chunk: Buffer) => {
      buf += chunk.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const [t, total, count, chromium] = line.trim().split(',').map(Number);
        if (Number.isFinite(t) && Number.isFinite(total)) {
          this.samples.push({ t: t!, totalBytes: total!, procCount: count!, chromiumBytes: chromium! });
        }
      }
    });
  }

  stop(): void {
    this.proc?.kill();
    this.proc = null;
  }

  /** Samples inside [from, to] — used to window a burst's peak. */
  between(from: number, to: number): MemSample[] {
    return this.samples.filter((s) => s.t >= from && s.t <= to);
  }

  peakBetween(from: number, to: number): MemSample | null {
    const w = this.between(from, to);
    return w.length ? w.reduce((a, b) => (b.totalBytes > a.totalBytes ? b : a)) : null;
  }

  latest(): MemSample | null {
    return this.samples[this.samples.length - 1] ?? null;
  }
}

// ─────── The worker process ─────────────────────────────────────────────────

export interface WorkerHandle {
  proc: ChildProcess;
  pid: number;
  /** Every stdout/stderr line, timestamped — pool logs are parsed from here. */
  lines: { t: number; line: string }[];
  stop: () => Promise<void>;
}

/**
 * Boot the WORKER process (main.worker.js — BullMQ + cron, no HTTP) with `env`
 * overlaid on the current environment, and resolve once it reports readiness.
 */
export async function startWorker(
  env: Record<string, string>,
  opts: { readyTimeoutMs?: number } = {},
): Promise<WorkerHandle> {
  const proc = spawn(process.execPath, [path.join(API_DIST, 'main.worker.js')], {
    env: { ...process.env, ...env },
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const lines: { t: number; line: string }[] = [];
  const collect = (chunk: Buffer) => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      if (line.trim()) lines.push({ t: Date.now(), line });
    }
  };
  proc.stdout!.on('data', collect);
  proc.stderr!.on('data', collect);

  const readyTimeoutMs = opts.readyTimeoutMs ?? 60_000;
  const deadline = Date.now() + readyTimeoutMs;
  while (Date.now() < deadline) {
    if (lines.some((l) => l.line.includes('Worker process started'))) {
      return {
        proc,
        pid: proc.pid!,
        lines,
        stop: async () => {
          if (proc.exitCode !== null) return;
          // SIGTERM is what Railway sends; this exercises the pool's graceful
          // shutdown (onModuleDestroy → browser.close()) rather than bypassing it.
          proc.kill('SIGTERM');
          await Promise.race([once(proc, 'exit'), sleep(15_000)]);
          if (proc.exitCode === null) proc.kill('SIGKILL');
        },
      };
    }
    if (proc.exitCode !== null) {
      throw new Error(`worker exited early (${proc.exitCode}):\n${lines.map((l) => l.line).join('\n')}`);
    }
    await sleep(200);
  }
  proc.kill('SIGKILL');
  throw new Error(`worker did not become ready in ${readyTimeoutMs}ms`);
}

/** Poll `check` until it returns true, or throw on timeout. */
export async function waitFor(
  check: () => Promise<boolean>,
  timeoutMs: number,
  pollMs = 250,
  label = 'condition',
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(pollMs);
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${label}`);
}

/** Pretty console table row helper. */
export function table(rows: Record<string, unknown>[]): void {
  // eslint-disable-next-line no-console
  console.table(rows);
}
