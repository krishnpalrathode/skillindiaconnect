import type { Config } from 'jest';
import base from './jest.config';

/**
 * Config for the REAL-Chromium specs (browser-pool, resume-render,
 * invoice-render), which the main pass excludes.
 *
 * THE FAILURE THIS FIXES: two real-Chromium specs sharing ONE jest worker
 * process fail — the SECOND launches into "Test environment has been torn down"
 * inside puppeteer's dynamic import. browser-pool.spec (which SIGKILLs Chromium
 * for its crash-recovery proof) leaves the worker's puppeteer/process state
 * unusable for the next Chromium spec. maxWorkers:2 passed only by luck (the 3
 * specs happened to land in separate workers); on CI browser-pool landed as a
 * worker's 2nd Chromium spec and failed. Verified: 3-in-one-process → 3rd fails;
 * 1-per-process → all pass.
 *
 * So the `test:chromium` script runs each spec as its OWN jest invocation
 * (`jest -c jest.chromium.config.ts <name>`), i.e. a fresh process per spec —
 * the only arrangement that is reliable. maxWorkers:1 is belt-and-braces (each
 * invocation is a single spec anyway).
 */
const config: Config = {
  ...base,
  testPathIgnorePatterns: ['/node_modules/'],
  testRegex: '(browser-pool|resume-render|invoice-render)\\.spec\\.ts$',
  maxWorkers: 1,
};

export default config;
