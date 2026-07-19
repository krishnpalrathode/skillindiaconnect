/**
 * S8-H3 — structured JSON logging with correlation ids and PII redaction.
 *
 * Replaces Nest's pretty console output in production. Two reasons:
 *  - a log aggregator cannot query the pretty format, so incidents are
 *    investigated by eye instead of by search, and
 *  - the pretty formatter stringifies whatever it is handed, which is exactly
 *    how PII reaches disk. Everything here goes through the H2-verified
 *    denylist (redaction.ts) before it is written.
 *
 * Format is one JSON object per line — the shape every aggregator ingests
 * without a custom parser:
 *   {"ts","level","ctx","msg","requestId","userId","role",...}
 *
 * Development keeps the readable Nest format: JSON logs are for machines, and
 * forcing them on a developer's terminal makes local work worse for no gain.
 */
import { ConsoleLogger, LogLevel } from '@nestjs/common';
import { getRequestContext } from './request-context';
import { redactText, redactValue } from './redaction';

const LEVEL_RANK: Record<string, number> = { verbose: 10, debug: 20, log: 30, warn: 40, error: 50 };

/**
 * Minimum level to emit. Defaults to `log` (i.e. debug/verbose OFF) so a
 * production deploy cannot accidentally ship debug logging — which is both a
 * cost and, since debug lines are the ones that dump whole objects, a privacy
 * risk.
 */
const MIN_LEVEL = LEVEL_RANK[process.env.LOG_LEVEL ?? 'log'] ?? 30;

export class StructuredLogger extends ConsoleLogger {
  private write(level: LogLevel, message: unknown, context?: string, extra?: unknown): void {
    if ((LEVEL_RANK[level] ?? 30) < MIN_LEVEL) return;

    const ctx = getRequestContext();
    const line: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level,
      ctx: context ?? this.context ?? undefined,
      msg: typeof message === 'string' ? redactText(message) : redactValue(message),
      // Correlation — this is what turns a pile of lines into a request trace.
      requestId: ctx?.requestId,
      userId: ctx?.userId,
      role: ctx?.role,
      route: ctx?.route,
    };
    if (extra !== undefined) line.detail = redactValue(extra);

    for (const k of Object.keys(line)) if (line[k] === undefined) delete line[k];

    const out = JSON.stringify(line);
    if (level === 'error') process.stderr.write(out + '\n');
    else process.stdout.write(out + '\n');
  }

  log(message: unknown, context?: string): void {
    this.write('log', message, context);
  }
  warn(message: unknown, context?: string): void {
    this.write('warn', message, context);
  }
  error(message: unknown, stack?: string, context?: string): void {
    this.write('error', message, context, stack ? { stack: redactText(stack) } : undefined);
  }
  debug(message: unknown, context?: string): void {
    this.write('debug', message, context);
  }
  verbose(message: unknown, context?: string): void {
    this.write('verbose', message, context);
  }
}

/**
 * Structured logging is opt-in via LOG_FORMAT=json (set it in staging and
 * production). Anything else keeps Nest's default human-readable logger.
 */
export function shouldUseStructuredLogging(): boolean {
  return (process.env.LOG_FORMAT ?? '').toLowerCase() === 'json';
}
