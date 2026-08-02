/**
 * Worker tuning — defaults, and the guard that keeps them applied.
 *
 * The second test is the one that matters. Every BullMQ worker costs Redis
 * commands FOREVER at BullMQ's defaults (drainDelay 5s, stalledInterval 30s),
 * whether or not it ever receives a job — that is what exhausted the Upstash
 * quota. A new `@Processor` that forgets a tier reintroduces ~14 commands/minute
 * silently: nothing breaks, no test fails, the bill just moves. This asserts the
 * omission is impossible to merge.
 *
 * It reads SOURCE rather than importing the processors on purpose — importing
 * them drags Chromium and Prisma into a test that is about two integers.
 *
 * See docs/redis-command-budget.md.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { MAINTENANCE_WORKER_OPTS, RESPONSIVE_WORKER_OPTS, WORKER_TUNING } from './worker-tuning';

const SRC_ROOT = join(__dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.processor.ts') && !entry.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

describe('WORKER_TUNING defaults', () => {
  it('long-polls far less often than BullMQ\'s 5s default', () => {
    expect(WORKER_TUNING.responsiveDrainDelayS).toBeGreaterThanOrEqual(60);
    expect(WORKER_TUNING.maintenanceDrainDelayS).toBeGreaterThanOrEqual(
      WORKER_TUNING.responsiveDrainDelayS,
    );
  });

  it('sweeps for stalled jobs far less often than BullMQ\'s 30s default', () => {
    expect(WORKER_TUNING.responsiveStalledIntervalMs).toBeGreaterThanOrEqual(300_000);
    expect(WORKER_TUNING.maintenanceStalledIntervalMs).toBeGreaterThanOrEqual(
      WORKER_TUNING.responsiveStalledIntervalMs,
    );
  });

  it('never DISABLES the stalled check — that is how a dead render is reclaimed', () => {
    expect(RESPONSIVE_WORKER_OPTS).not.toHaveProperty('skipStalledCheck');
    expect(MAINTENANCE_WORKER_OPTS).not.toHaveProperty('skipStalledCheck');
    expect(RESPONSIVE_WORKER_OPTS.stalledInterval).toBeGreaterThan(0);
  });
});

describe('every @Processor declares a tuning tier', () => {
  const processorFiles = walk(SRC_ROOT).filter((f) => readFileSync(f, 'utf8').includes('@Processor('));

  it('finds the processors (guards against the walker silently matching nothing)', () => {
    expect(processorFiles.length).toBeGreaterThanOrEqual(8);
  });

  it.each(processorFiles.map((f) => [f.slice(SRC_ROOT.length + 1), f]))(
    '%s applies RESPONSIVE_WORKER_OPTS or MAINTENANCE_WORKER_OPTS',
    (_label, file) => {
      const source = readFileSync(file as string, 'utf8');
      const hasTier =
        source.includes('RESPONSIVE_WORKER_OPTS') || source.includes('MAINTENANCE_WORKER_OPTS');
      expect(hasTier).toBe(true);
    },
  );
});
