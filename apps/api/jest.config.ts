import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { isolatedModules: true }],
  },
  testEnvironment: 'node',
  // The three REAL-Chromium specs are excluded here and run in their own serial
  // pass (jest.chromium.config.ts) — see the note there. Keeping them out of the
  // parallel pool is what stops a Chromium launch from colliding with a
  // testcontainer spec and OOM-killing a worker on the constrained CI runner.
  testPathIgnorePatterns: [
    '/node_modules/',
    'pdf/browser-pool\\.spec\\.ts$',
    'resume/resume-render\\.spec\\.ts$',
    'payments/invoice-render\\.spec\\.ts$',
  ],
  // Resolve @skillindiaconnect/* workspace packages to their TypeScript source
  moduleNameMapper: {
    '^@skillindiaconnect/shared-config$': '<rootDir>/../../packages/shared-config/src',
    '^@skillindiaconnect/shared-types$': '<rootDir>/../../packages/shared-types/src',
    '^@skillindiaconnect/resume-template$': '<rootDir>/../../packages/resume-template/src',
  },
  // Cap parallelism so that testcontainers integration tests (which spin up Docker
  // containers and consume significant memory) don't OOM when running alongside
  // CPU-heavy specs like argon2. 2 workers is enough for CI speed without the
  // memory spike from fully parallel execution.
  maxWorkers: 2,
  // S7-B1: the browser-pool spec deliberately SIGKILLs Chromium (timeout +
  // crash-recovery proofs); puppeteer's internal process handles then keep the
  // event loop alive after all tests + hooks complete. forceExit skips only
  // that final wait — afterAll/afterEach cleanup (incl. testcontainers stops)
  // still runs. detectOpenHandles was used to verify our OWN handles are clean.
  forceExit: true,
};

export default config;
