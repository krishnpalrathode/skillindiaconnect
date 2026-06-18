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
  // Testcontainers is installed as a devDependency for future integration tests
  // that require a real Postgres or Redis instance. Container-backed tests are
  // added in Prompt 2 alongside PrismaService. See: https://testcontainers.com/
};

export default config;
