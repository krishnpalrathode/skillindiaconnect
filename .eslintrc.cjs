/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: true,
    tsconfigRootDir: __dirname,
  },
  plugins: ['@typescript-eslint', 'prettier'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
  ],
  rules: {
    'prettier/prettier': 'error',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'error',
  },
  env: {
    node: true,
    es2022: true,
  },
  ignorePatterns: [
    'dist/',
    '.next/',
    'node_modules/',
    '*.config.mjs',
    '*.config.cjs',
    'postcss.config.*',
    'next-env.d.ts',
  ],
  overrides: [
    // ── apps/api ─────────────────────────────────────────────────────────────
    // Boundary rules for the NestJS codebase.
    // eslint-plugin-import is hoisted to root node_modules via eslint-config-next.
    {
      files: ['apps/api/{src,test}/**/*.ts'],
      plugins: ['import'],
      rules: {
        // No relative escapes out of the packages directory; no importing entrypoints.
        'no-restricted-imports': ['error', {
          patterns: [
            {
              group: ['../../packages/*', '../../../packages/*'],
              message: 'Import @skillindiaconnect/* packages by name, not relative paths.',
            },
            {
              group: ['**/main.api', '**/main.worker'],
              message: 'Entrypoints must not be imported.',
            },
          ],
        }],

        // Cross-module zone enforcement.
        // Paths below are relative to the monorepo root (where ESLint runs).
        // ADD ONE ENTRY PER MODULE AS YOU CREATE IT (S1+).
        //
        // When zone count reaches ~3+, migrate to eslint-plugin-boundaries for
        // auto-enforcement without per-module zone boilerplate.
        'import/no-restricted-paths': ['error', {
          zones: [
            // candidate: other modules must not import candidate internals directly.
            // They import CandidateReadService via the public export from CandidateModule.
            {
              target: './apps/api/src/auth',
              from: './apps/api/src/candidate',
              except: ['./candidate-read.service.ts'],
              message: 'Auth must not reach into candidate internals. Import CandidateReadService via CandidateModule export.',
            },
          ],
        }],
      },
    },
  ],
};
