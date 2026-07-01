/** @type {import('eslint').Linter.Config} */
module.exports = {
  extends: ['next/core-web-vitals', '../../.eslintrc.cjs'],
  rules: {
    // next/core-web-vitals provides its own parser options; relax the TypeScript
    // project requirement for JSX files that next lint handles.
    '@typescript-eslint/explicit-module-boundary-types': 'off',

    // web is HTTP-only — it never touches the DB, Redis, or API internals.
    // See .claude/rules/module-boundaries.md Rule 1.
    'no-restricted-imports': [
      'error',
      {
        paths: [
          {
            name: '@prisma/client',
            message: 'web is HTTP-only — call the API; never touch the DB.',
          },
          {
            name: 'ioredis',
            message: 'web is HTTP-only — call the API; never touch Redis.',
          },
        ],
        patterns: [
          {
            group: ['**/apps/api/**'],
            message: 'web must not import API internals — use the HTTP contract.',
          },
          {
            group: ['../../packages/*', '../../../packages/*'],
            message: 'Import @skillindiaconnect/* packages by name, not relative paths.',
          },
        ],
      },
    ],
  },
};
