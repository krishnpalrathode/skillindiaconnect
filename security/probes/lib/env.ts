/**
 * S8-H2 — repo-root .env loader with an IMPORT-ORDER side effect.
 *
 * This lives in its own module on purpose. TypeScript hoists every `import` in a
 * file above other statements when it emits CommonJS, so an inline
 * `loadRootEnv()` call placed between imports still runs AFTER the modules below
 * it have been required. AppConfigModule resolves the root `.env` relative to its
 * COMPILED location (apps/api/dist/...), so a probe that loads it from source
 * misses the file entirely and `validateEnv()` calls `process.exit(1)` — which on
 * Windows truncates the pending stderr write, producing a silent exit-1 with no
 * message at all.
 *
 * Importing THIS module first guarantees the env is populated before anything
 * from apps/api is evaluated:
 *
 *     import './lib/env';                       // must be first
 *     import { AppApiModule } from '...';
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

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
    // Existing env wins, so a per-run override on the command line is honoured.
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadRootEnv();
