import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { LOCALES, LOCALE_CODES, DEFAULT_LOCALE, getDirection, getIntlLocale } from '../locales';

const messagesDir = join(__dirname, '..', 'messages');

type Node = string | { [k: string]: Node } | Node[];

function flatten(node: Node, prefix = '', out: Record<string, string> = {}) {
  if (typeof node === 'string') {
    out[prefix] = node;
  } else if (Array.isArray(node)) {
    node.forEach((child, i) => flatten(child, `${prefix}[${i}]`, out));
  } else {
    for (const [k, v] of Object.entries(node)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  }
  return out;
}

function readCatalog(code: string) {
  const file = join(messagesDir, `${code}.json`);
  return existsSync(file) ? flatten(JSON.parse(readFileSync(file, 'utf8')) as Node) : null;
}

/**
 * Extract ICU argument names — `{pct}`, `{max, number}` → `pct`, `max`.
 * Deliberately ignores the format part: a translator may legitimately not
 * reorder or restyle, but dropping or renaming an ARGUMENT breaks the message at
 * runtime.
 */
function icuArgs(message: string): string[] {
  return [...message.matchAll(/\{\s*([A-Za-z0-9_]+)\s*(?:,[^}]*)?\}/g)].map((m) => m[1]!).sort();
}

const english = readCatalog(DEFAULT_LOCALE)!;
const translatedLocales = LOCALE_CODES.filter((c) => c !== DEFAULT_LOCALE);

describe('locale registry', () => {
  it('routing exposes every registered locale, defaultLocale included', () => {
    expect(LOCALE_CODES).toContain(DEFAULT_LOCALE);
    expect(new Set(LOCALE_CODES).size).toBe(LOCALE_CODES.length);
  });

  it('every locale carries the metadata the UI reads', () => {
    for (const l of LOCALES) {
      // A blank nativeName would render an unpickable option in the switcher —
      // the one control a user who cannot read the current language depends on.
      expect(l.nativeName.trim(), l.code).not.toBe('');
      expect(l.shortLabel.trim(), l.code).not.toBe('');
      expect(['ltr', 'rtl']).toContain(l.dir);
      // Must be a tag Intl actually accepts, or every formatted date on that
      // locale throws at render time.
      expect(() => new Intl.DateTimeFormat(l.intlLocale), l.code).not.toThrow();
    }
  });

  it('resolves an unknown locale to the default instead of throwing', () => {
    expect(getDirection('zz')).toBe('ltr');
    expect(getIntlLocale('zz')).toBe(getIntlLocale(DEFAULT_LOCALE));
    expect(getDirection(undefined)).toBe('ltr');
  });

  it('marks Arabic and Urdu as RTL and the Indic languages as LTR', () => {
    expect(getDirection('ar')).toBe('rtl');
    expect(getDirection('ur')).toBe('rtl');
    expect(getDirection('hi')).toBe('ltr');
    expect(getDirection('ml')).toBe('ltr');
  });
});

describe('message catalogs', () => {
  it.each(translatedLocales)('%s has a catalog file', (code) => {
    expect(readCatalog(code), `src/i18n/messages/${code}.json is missing`).not.toBeNull();
  });

  /*
    A key present in a locale but NOT in English is dead weight: `request.ts`
    merges over English, so nothing renders it, and it survives as a permanent
    false signal in the coverage report. This catches a rename in en.json that
    the translated catalogs were not carried through.
  */
  it.each(translatedLocales)('%s has no keys that English does not', (code) => {
    const catalog = readCatalog(code);
    if (!catalog) return;
    const orphans = Object.keys(catalog).filter((k) => !(k in english));
    expect(orphans, `orphan keys in ${code}.json`).toEqual([]);
  });

  /*
    The failure mode that actually bites translated catalogs. next-intl throws at
    RENDER time on an unknown ICU argument, so a translator writing `{पृष्ठ}` for
    `{page}` produces a page that 500s in that language only — invisible to
    anyone testing in English.
  */
  it.each(translatedLocales)('%s preserves every ICU argument name', (code) => {
    const catalog = readCatalog(code);
    if (!catalog) return;
    const mismatches: string[] = [];
    for (const [key, value] of Object.entries(catalog)) {
      const expected = icuArgs(english[key] ?? '');
      const actual = icuArgs(value);
      if (expected.join(',') !== actual.join(',')) {
        mismatches.push(`${key}: expected {${expected.join(', ')}} got {${actual.join(', ')}}`);
      }
    }
    expect(mismatches, `ICU argument drift in ${code}.json`).toEqual([]);
  });
});
