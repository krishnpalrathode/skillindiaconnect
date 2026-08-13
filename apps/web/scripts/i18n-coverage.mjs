#!/usr/bin/env node
/**
 * Translation coverage report.
 *
 * English is the reference catalog; every other locale is measured against it.
 * Because `src/i18n/request.ts` merges each catalog over English, an untranslated
 * key renders in English rather than throwing — which is what makes a partial
 * locale shippable, and also what makes the gap invisible without this script.
 *
 *   node scripts/i18n-coverage.mjs           # summary table
 *   node scripts/i18n-coverage.mjs --details # + the missing keys per locale
 *   node scripts/i18n-coverage.mjs --min 60  # exit 1 if any locale is under 60%
 *
 * `--min` is what a CI gate would use to stop a locale from regressing; there is
 * deliberately no default threshold, because most locales are legitimately
 * partial right now and a default would just fail the build.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const messagesDir = join(here, '..', 'src', 'i18n', 'messages');
const localesFile = join(here, '..', 'src', 'i18n', 'locales.ts');

/** Flatten to dotted paths so nested namespaces compare key-for-key. */
function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, path, out);
    else out[path] = v;
  }
  return out;
}

function readCatalog(code) {
  const file = join(messagesDir, `${code}.json`);
  if (!existsSync(file)) return null;
  return flatten(JSON.parse(readFileSync(file, 'utf8')));
}

/*
  The locale codes are read out of locales.ts rather than by globbing the
  messages directory: a registered locale with NO catalog file is exactly the
  case worth reporting, and globbing would silently skip it.
*/
const registry = readFileSync(localesFile, 'utf8');
const codes = [...registry.matchAll(/^\s{4}code: '([a-z-]+)',$/gm)].map((m) => m[1]);
if (codes.length === 0) {
  console.error('Could not read locale codes from src/i18n/locales.ts');
  process.exit(1);
}

const english = readCatalog('en');
const total = Object.keys(english).length;
const details = process.argv.includes('--details');
const minIdx = process.argv.indexOf('--min');
const min = minIdx !== -1 ? Number(process.argv[minIdx + 1]) : null;

console.log(`\nReference: en — ${total} keys\n`);
console.log('locale   coverage   translated   missing   file');
console.log('─'.repeat(58));

const failures = [];
for (const code of codes) {
  if (code === 'en') continue;
  const catalog = readCatalog(code);
  const present = catalog
    ? Object.keys(english).filter((k) => typeof catalog[k] === 'string' && catalog[k].trim() !== '')
    : [];
  const pct = Math.round((present.length / total) * 100);
  const missing = total - present.length;
  const bar = `${String(pct).padStart(3)}%`;
  console.log(
    `${code.padEnd(8)} ${bar.padEnd(10)} ${String(present.length).padStart(10)} ${String(missing).padStart(9)}   ${catalog ? 'yes' : 'MISSING'}`,
  );
  if (min !== null && pct < min) failures.push(`${code} at ${pct}% (min ${min}%)`);

  if (details && catalog) {
    const missingKeys = Object.keys(english).filter(
      (k) => !(typeof catalog[k] === 'string' && catalog[k].trim() !== ''),
    );
    // Grouped by top-level namespace — that is the unit translation work is
    // actually commissioned in.
    const byNamespace = {};
    for (const k of missingKeys) {
      const ns = k.split('.')[0];
      byNamespace[ns] = (byNamespace[ns] ?? 0) + 1;
    }
    const summary = Object.entries(byNamespace)
      .sort((a, b) => b[1] - a[1])
      .map(([ns, n]) => `${ns}(${n})`)
      .join(' ');
    if (summary) console.log(`         missing: ${summary}`);
  }
}

console.log('');
if (failures.length) {
  console.error('Below threshold:\n  ' + failures.join('\n  '));
  process.exit(1);
}
