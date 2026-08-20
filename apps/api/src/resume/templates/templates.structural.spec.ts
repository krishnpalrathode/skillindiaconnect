/**
 * CR-001 B2 — the structural guarantee behind the privacy design.
 *
 * Every other test in this feature checks OUTPUT: render a view, extract the
 * PDF text, assert a hidden value is absent. Those tests are written against a
 * CORRECTLY-MAPPED view, so they would all pass for a template that quietly
 * read the raw profile instead — and that template would leak the moment a
 * candidate turned a toggle off.
 *
 * This spec checks the thing output tests cannot: that a template has no way to
 * reach the data the mapper withheld. It reads the SOURCE of every template and
 * asserts none of them imports a database client, a service, config, or
 * anything beyond the view type and the shared helpers. There is simply nothing
 * in scope to reach around the mapper with.
 *
 * Precedent: pdf/worker-only.structural.spec.ts does the same for the
 * Chromium-in-the-API boundary.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { TEMPLATE_REGISTRY } from './registry';

const TEMPLATE_DIR = __dirname;

/**
 * Everything a template file is allowed to import from.
 *
 * `./sidebar-family` is the shared layout for the six-colourway sidebar family.
 * It is on this list, and it is ALSO scanned by this spec (see templateFiles
 * below), so admitting it widens the surface by exactly one file that is held
 * to the same rule — a template still cannot reach the raw profile through it.
 */
const ALLOWED_IMPORTS = ['../resume-view.mapper', './shared', './sidebar-family'];

/**
 * Imports that would defeat the design outright. Named explicitly (rather than
 * relying only on the allow-list) so a failure says WHAT went wrong.
 */
const FORBIDDEN_PATTERNS: Array<[RegExp, string]> = [
  [/@prisma\/client/, 'a Prisma client — a template must never query the database'],
  [/prisma\.service/, 'PrismaService — the template would bypass the mapper'],
  [/candidate-read\.service/, 'CandidateReadService — that is the RAW profile'],
  [/@nestjs\/config|ConfigService/, 'ConfigService — templates take no configuration'],
  [/resume-settings\.service/, 'the settings service — templates apply no settings'],
  [/process\.env/, 'process.env — a template is a pure function of the view'],
];

function templateFiles(): string[] {
  return readdirSync(TEMPLATE_DIR).filter(
    (f) =>
      (f.endsWith('.template.ts') ||
        // The shared layout renders too, so it gets the same scrutiny as the
        // templates that delegate to it. Leaving it unscanned would move the
        // rendering out of reach of the guard that protects it.
        f === 'sidebar-family.ts') &&
      !f.endsWith('.spec.ts'),
  );
}

function importsOf(source: string): string[] {
  return [...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]!);
}

describe('template modules are structurally unable to bypass the mapper', () => {
  const files = templateFiles();

  it('scans one file per registered template (guards against matching nothing)', () => {
    /*
      A spec that scans zero files passes loudly and proves nothing — that is
      what this guards. It used to name the four template files literally, which
      also meant the guard FAILED the moment a fifth template was added, telling
      whoever added it nothing useful.

      Comparing against TEMPLATE_REGISTRY keeps both properties and adds a real
      one: a renderer that exists but was never registered (so it can never be
      selected) and a registry entry with no file both surface here.
    */
    const expected = [
      ...Object.keys(TEMPLATE_REGISTRY).map((t) => `${t.toLowerCase()}.template.ts`),
      // Scanned as well, and asserted here so it cannot quietly stop being
      // scanned — that would move the six sidebar templates' actual rendering
      // outside this guard while every per-file check still passed.
      'sidebar-family.ts',
    ].sort();
    expect(files.sort()).toEqual(expected);
  });

  it.each(templateFiles())('%s imports ONLY the view type and shared helpers', (file) => {
    const imports = importsOf(readFileSync(join(TEMPLATE_DIR, file), 'utf8'));
    expect(imports.length).toBeGreaterThan(0);
    for (const spec of imports) {
      expect(ALLOWED_IMPORTS).toContain(spec);
    }
  });

  it.each(templateFiles())('%s contains no forbidden reference', (file) => {
    const source = readFileSync(join(TEMPLATE_DIR, file), 'utf8');
    // Strip comments — the docblocks legitimately NAME these things while
    // explaining why they are absent, and a naive scan would flag the prose.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const [pattern, why] of FORBIDDEN_PATTERNS) {
      if (pattern.test(code)) {
        throw new Error(`${file} references ${why}`);
      }
    }
  });

  it.each(templateFiles())('%s escapes through the SHARED esc(), never its own copy', (file) => {
    const source = readFileSync(join(TEMPLATE_DIR, file), 'utf8');

    /*
      The rule is about files that EMIT MARKUP. Most templates in the sidebar
      family only supply a theme object and delegate the rendering, so they
      interpolate nothing and have nothing to escape — requiring the import
      there would be cargo-cult, and worse, it would teach the next person to
      add an unused import to satisfy a test.

      So: a file that builds HTML must import the shared esc; a file that
      builds none is exempt. Either way NOBODY may define a private copy,
      which is the security-relevant half — one copy drifts, misses a
      character, and user text injects markup into the render context.
    */
    const emitsMarkup = /<[a-z!]/i.test(source);
    if (emitsMarkup) {
      expect(source).toMatch(/import\s*\{[^}]*\besc\b[^}]*\}\s*from\s*'\.\/shared'/s);
    }
    expect(source).not.toMatch(/function\s+esc\s*\(/);
  });
});
