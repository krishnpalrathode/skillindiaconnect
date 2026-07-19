/**
 * S8-H2 — boots the compiled API and provides the raw HTTP client the probes use.
 *
 * The API is started from `apps/api/dist` (the production build) as its own
 * process, exactly as it runs in production, so the audit describes the shipped
 * artifact rather than a ts-node approximation.
 */
import { ChildProcess, spawn } from 'node:child_process';
import path from 'node:path';
import { REPO_ROOT } from './env';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ApiHandle {
  proc: ChildProcess;
  base: string;
  /** Every line the API wrote — probes assert on log content (no-PII checks). */
  logs: string[];
  stop: () => Promise<void>;
}

export interface Res {
  status: number;
  body: unknown;
  text: string;
  headers: Record<string, string>;
  ms: number;
}

export async function startApi(
  port: number,
  env: Record<string, string> = {},
): Promise<ApiHandle> {
  const proc = spawn(process.execPath, [path.join(REPO_ROOT, 'apps', 'api', 'dist', 'main.api.js')], {
    env: { ...process.env, ...env, PORT: String(port) },
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs: string[] = [];
  const collect = (c: Buffer) => {
    for (const line of c.toString().split(/\r?\n/)) if (line.trim()) logs.push(line);
  };
  proc.stdout!.on('data', collect);
  proc.stderr!.on('data', collect);

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      throw new Error(`API exited (${proc.exitCode}):\n${logs.join('\n')}`);
    }
    try {
      const r = await fetch(`${base}/health`);
      if (r.ok) {
        return {
          proc,
          base,
          logs,
          stop: async () => {
            if (proc.exitCode !== null) return;
            proc.kill('SIGTERM');
            await sleep(1200);
            if (proc.exitCode === null) proc.kill('SIGKILL');
          },
        };
      }
    } catch {
      /* not listening yet */
    }
    await sleep(300);
  }
  proc.kill('SIGKILL');
  throw new Error(`API did not become healthy:\n${logs.join('\n')}`);
}

/**
 * A single request. Never throws on a non-2xx — probes assert on status codes,
 * so an error response is data, not an exception.
 */
export async function req(
  base: string,
  method: string,
  path: string,
  opts: { token?: string | null; body?: unknown; headers?: Record<string, string>; raw?: string | Buffer } = {},
): Promise<Res> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;

  let payload: string | Buffer | undefined;
  if (opts.raw !== undefined) {
    payload = opts.raw;
  } else if (opts.body !== undefined) {
    payload = JSON.stringify(opts.body);
    headers['content-type'] = headers['content-type'] ?? 'application/json';
  }

  const started = Date.now();
  const res = await fetch(`${base}${path}`, { method, headers, body: payload as BodyInit | undefined });
  const text = await res.text();
  const ms = Date.now() - started;

  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  const hdrs: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    hdrs[k] = v;
  });
  return { status: res.status, body, text, headers: hdrs, ms };
}

/** The machine-readable error code from the RFC-7807 envelope, if present. */
export function codeOf(res: Res): string | null {
  const b = res.body as { code?: unknown } | null;
  return b && typeof b.code === 'string' ? b.code : null;
}

/** Deep search for a key anywhere in a response — the omission probes' workhorse. */
export function findKeyDeep(value: unknown, key: string, seen = new Set<unknown>()): boolean {
  if (value === null || typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((v) => findKeyDeep(v, key, seen));
  const obj = value as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(obj, key)) return true;
  return Object.values(obj).some((v) => findKeyDeep(v, key, seen));
}

/** Deep search for a VALUE substring anywhere in the raw response text. */
export function containsValue(res: Res, needle: string): boolean {
  return res.text.toLowerCase().includes(needle.toLowerCase());
}
