/**
 * S7-B1 — THE STRUCTURAL GUARANTEE: Chromium never enters the API process.
 *
 * Walks the RELATIVE import graph from app-api.module.ts (source-level,
 * comment-stripped) and asserts that no file in the API's closure lives under
 * src/pdf/ or imports puppeteer. The worker graph is asserted to INCLUDE the
 * pool — so the test fails loudly if someone re-homes the renderer, in either
 * direction.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const SRC = path.resolve(__dirname, '..');

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** All transitively-reached src files from an entry module (relative imports only). */
function importClosure(entryRelative: string): Set<string> {
  const seen = new Set<string>();
  const queue = [path.resolve(SRC, entryRelative)];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file) || !fs.existsSync(file)) continue;
    seen.add(file);
    const source = stripComments(fs.readFileSync(file, 'utf8'));
    for (const match of source.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
      const spec = match[1]!;
      const base = path.resolve(path.dirname(file), spec);
      for (const candidate of [`${base}.ts`, path.join(base, 'index.ts')]) {
        if (fs.existsSync(candidate)) {
          queue.push(candidate);
          break;
        }
      }
    }
  }
  return seen;
}

describe('worker-only Chromium (structural)', () => {
  it('the API module graph reaches NO pdf/ file and never imports puppeteer', () => {
    const closure = importClosure('app-api.module.ts');
    expect(closure.size).toBeGreaterThan(50); // the walk genuinely walked

    const pdfDir = path.resolve(SRC, 'pdf') + path.sep;
    const offenders = [...closure].filter((f) => f.startsWith(pdfDir));
    expect(offenders).toEqual([]); // any entry names the file that breached the boundary

    const puppeteerImporters = [...closure].filter((file) =>
      /['"]puppeteer['"]/.test(stripComments(fs.readFileSync(file, 'utf8'))),
    );
    expect(puppeteerImporters.map((f) => path.relative(SRC, f))).toEqual([]);
  });

  it('the WORKER module graph DOES reach the pool (the renderer lives where it should)', () => {
    const closure = importClosure('app-worker.module.ts');
    const poolFile = path.resolve(SRC, 'pdf', 'browser-pool.service.ts');
    expect(closure.has(poolFile)).toBe(true);
  });
});
