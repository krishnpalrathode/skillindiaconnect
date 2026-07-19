/**
 * S8-H3 — the chaos harness: dependency control, process lifecycle, and the
 * pass/fail recorder shared by every scenario.
 *
 * Failures are injected in the way the real failure happens:
 *   - a dependency outage  → the container is STOPPED (a real refused socket)
 *   - a gateway outage     → an outbound-network preload (see inject-network-fault.cjs)
 *   - a process crash      → SIGKILL (no graceful-shutdown handlers run)
 * Nothing is simulated inside the application code, because the point is to
 * test the code that ships, not a chaos-only branch of it.
 */
import { ChildProcess, execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const REPO_ROOT = path.resolve(__dirname, '..', '..');
export const API_DIST = path.join(REPO_ROOT, 'apps', 'api', 'dist');

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─────── env ────────────────────────────────────────────────────────────────

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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadRootEnv();

// ─────── Dependency control (real containers) ───────────────────────────────

export const CONTAINERS = {
  postgres: 'skillindiaconnect-postgres',
  redis: 'skillindiaconnect-redis',
  minio: 'skillindiaconnect-minio',
} as const;

export type Dependency = keyof typeof CONTAINERS;

function docker(args: string): string {
  return execSync(`docker ${args}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export function isUp(dep: Dependency): boolean {
  try {
    return docker(`inspect -f "{{.State.Running}}" ${CONTAINERS[dep]}`) === 'true';
  } catch {
    return false;
  }
}

/** Stop a dependency — a genuinely refused socket, not a mocked client. */
export function killDependency(dep: Dependency): void {
  docker(`stop -t 0 ${CONTAINERS[dep]}`);
}

export function reviveDependency(dep: Dependency): void {
  docker(`start ${CONTAINERS[dep]}`);
}

/** Bring a dependency back and wait until it actually answers. */
export async function reviveAndWait(dep: Dependency, timeoutMs = 90_000): Promise<void> {
  reviveDependency(dep);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (dep === 'redis') {
        if (docker(`exec ${CONTAINERS.redis} redis-cli ping`).includes('PONG')) return;
      } else if (dep === 'postgres') {
        if (docker(`exec ${CONTAINERS.postgres} pg_isready -U postgres`).includes('accepting')) return;
      } else {
        // MinIO has no cheap in-container probe; a TCP connect is enough.
        const res = await fetch('http://127.0.0.1:9000/minio/health/live').catch(() => null);
        if (res) return;
      }
    } catch {
      /* not ready yet */
    }
    await sleep(1000);
  }
  throw new Error(`${dep} did not come back within ${timeoutMs}ms`);
}

/**
 * Run `fn` with `dep` stopped, ALWAYS restoring it afterwards — including on
 * throw. A chaos script that leaves Redis down poisons every later scenario.
 */
export async function withDependencyDown<T>(dep: Dependency, fn: () => Promise<T>): Promise<T> {
  killDependency(dep);
  try {
    return await fn();
  } finally {
    await reviveAndWait(dep);
  }
}

// ─────── Process lifecycle ──────────────────────────────────────────────────

export interface ProcHandle {
  proc: ChildProcess;
  pid: number;
  logs: string[];
  /** SIGTERM then SIGKILL — the graceful path. */
  stop: () => Promise<void>;
  /** Kill the whole process tree (teardown convenience). */
  kill: () => void;
  /** Kill ONLY this process, orphaning children — the faithful OOM-kill shape. */
  killSelfOnly: () => void;
  exited: () => boolean;
}

function spawnNode(entry: string, env: Record<string, string>): ProcHandle {
  const proc = spawn(process.execPath, [entry], {
    env: { ...process.env, ...env },
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs: string[] = [];
  const collect = (c: Buffer) => {
    for (const line of c.toString().split(/\r?\n/)) if (line.trim()) logs.push(line);
  };
  proc.stdout!.on('data', collect);
  proc.stderr!.on('data', collect);

  return {
    proc,
    pid: proc.pid!,
    logs,
    exited: () => proc.exitCode !== null || proc.signalCode !== null,
    /**
     * Kill the process TREE. Convenient for teardown, but NOT a faithful crash
     * simulation — see killSelfOnly.
     */
    kill: () => {
      try {
        if (process.platform === 'win32') {
          execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: 'ignore' });
        } else {
          proc.kill('SIGKILL');
        }
      } catch {
        /* already gone */
      }
    },

    /**
     * Kill ONLY this process, leaving any children orphaned — the faithful
     * simulation of an OOM-kill or a hard crash.
     *
     * This distinction matters and is easy to get wrong: a tree-kill also
     * reaps the Chromium children, so a zombie check run against `kill()`
     * would "prove" there are no orphans when all it proved is that the test
     * harness cleaned up. The kernel's OOM killer targets one process; whether
     * its children survive is exactly the property under test.
     */
    killSelfOnly: () => {
      try {
        if (process.platform === 'win32') {
          execSync(`taskkill /PID ${proc.pid} /F`, { stdio: 'ignore' });
        } else {
          process.kill(proc.pid!, 'SIGKILL');
        }
      } catch {
        /* already gone */
      }
    },
    stop: async () => {
      if (proc.exitCode !== null) return;
      proc.kill('SIGTERM');
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline && proc.exitCode === null) await sleep(200);
      if (proc.exitCode === null) {
        if (process.platform === 'win32') {
          try {
            execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: 'ignore' });
          } catch {
            /* gone */
          }
        } else proc.kill('SIGKILL');
      }
    },
  };
}

export async function startApi(port: number, env: Record<string, string> = {}): Promise<ProcHandle & { base: string }> {
  const h = spawnNode(path.join(API_DIST, 'main.api.js'), { ...env, PORT: String(port) });
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (h.exited()) throw new Error(`API exited early:\n${h.logs.slice(-25).join('\n')}`);
    try {
      const r = await fetch(`${base}/health`);
      if (r.ok) return Object.assign(h, { base });
    } catch {
      /* not listening yet */
    }
    await sleep(300);
  }
  h.kill();
  throw new Error(`API did not become healthy:\n${h.logs.slice(-25).join('\n')}`);
}

export async function startWorker(env: Record<string, string> = {}): Promise<ProcHandle> {
  const h = spawnNode(path.join(API_DIST, 'main.worker.js'), env);
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (h.exited()) throw new Error(`worker exited early:\n${h.logs.slice(-25).join('\n')}`);
    if (h.logs.some((l) => l.includes('Worker process started'))) return h;
    await sleep(200);
  }
  h.kill();
  throw new Error(`worker never started:\n${h.logs.slice(-25).join('\n')}`);
}

// ─────── HTTP ───────────────────────────────────────────────────────────────

export interface Res {
  status: number;
  body: unknown;
  text: string;
  ms: number;
}

export async function req(
  base: string,
  method: string,
  p: string,
  opts: { token?: string | null; body?: unknown; timeoutMs?: number } = {},
): Promise<Res> {
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  let payload: string | undefined;
  if (opts.body !== undefined) {
    payload = JSON.stringify(opts.body);
    headers['content-type'] = 'application/json';
  }
  const started = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 20_000);
  try {
    const res = await fetch(`${base}${p}`, { method, headers, body: payload, signal: ac.signal });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON */
    }
    return { status: res.status, body, text, ms: Date.now() - started };
  } catch (e) {
    // A timeout/abort IS a result for chaos purposes — report it as status 0.
    return { status: 0, body: null, text: String(e), ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

export const codeOf = (r: Res): string | null => {
  const b = r.body as { code?: unknown } | null;
  return b && typeof b.code === 'string' ? b.code : null;
};

/** Poll until `check` is true, or throw. */
export async function waitFor(
  check: () => Promise<boolean>,
  timeoutMs: number,
  label: string,
  pollMs = 300,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(pollMs);
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${label}`);
}

// ─────── Recorder ───────────────────────────────────────────────────────────

export type Verdict = 'PASS' | 'FAIL';

export interface ChaosCheck {
  id: string;
  scenario: string;
  /** The architectural promise being tested, in plain words. */
  promise: string;
  injected: string;
  expected: string;
  observed: string;
  verdict: Verdict;
  severity: 'Critical' | 'High' | 'Medium' | 'Low' | 'Info';
  detail?: Record<string, unknown>;
}

export class ChaosRecorder {
  readonly checks: ChaosCheck[] = [];

  check(c: Omit<ChaosCheck, 'verdict'> & { pass: boolean }): ChaosCheck {
    const { pass, ...rest } = c;
    const rec: ChaosCheck = { ...rest, verdict: pass ? 'PASS' : 'FAIL' };
    this.checks.push(rec);
    const mark = pass ? '  ✓' : '  ✗';
    console.log(`${mark} [${rec.severity}] ${rec.id}`);
    console.log(`      promise : ${rec.promise}`);
    console.log(`      injected: ${rec.injected}`);
    console.log(`      expected: ${rec.expected}`);
    console.log(`      observed: ${rec.observed}`);
    return rec;
  }

  get failures(): ChaosCheck[] {
    return this.checks.filter((c) => c.verdict === 'FAIL');
  }

  summary(): string {
    const f = this.failures.length;
    return `${this.checks.length - f}/${this.checks.length} promises held${f ? `  ✗ ${f} BROKEN` : '  ✓ all held'}`;
  }

  write(filename: string): string {
    const outDir = path.join(REPO_ROOT, 'chaos', 'out');
    mkdirSync(outDir, { recursive: true });
    const file = path.join(outDir, filename);
    writeFileSync(
      file,
      JSON.stringify(
        { generatedAt: new Date().toISOString(), total: this.checks.length, failed: this.failures.length, checks: this.checks },
        null,
        2,
      ),
    );
    return file;
  }
}

/** Standard scenario footer. */
export function finish(rec: ChaosRecorder, filename: string): void {
  console.log(`\n${rec.summary()}`);
  console.log(`evidence → ${path.relative(REPO_ROOT, rec.write(filename))}`);
  if (rec.failures.length > 0) process.exitCode = 1;
}
