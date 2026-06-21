import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  testEnvironment: 'node',
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
};

export default config;
