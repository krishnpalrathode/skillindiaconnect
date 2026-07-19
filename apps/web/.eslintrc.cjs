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

    /**
     * A11Y-003 (S8-H4) — contrast guardrails on the neutral ramp.
     *
     * `text-neutral-400` is 2.18:1 on white and `text-neutral-500` is 3.52:1.
     * Both fail WCAG 1.4.3's 4.5:1 minimum for body text, and the audit found
     * them used as real content — including an application's reference number.
     * `neutral-600` is 5.9:1 and reads as the same "muted" step visually.
     *
     * Physical-direction utilities are banned for the same reason they always
     * were (frontend-conventions.md): they are what stops a component
     * mirroring under `dir="rtl"`, and this product's Gulf users read RTL.
     * The static sweep found zero of them — this keeps it that way.
     *
     * Disabled controls and placeholders are legitimately exempt from 1.4.3;
     * where the audit left those in place they carry `cursor-not-allowed` or
     * `disabled:` and are individually justified.
     */
    'no-restricted-syntax': [
      'warn',
      {
        selector:
          "Literal[value=/(^|\\s)text-neutral-(400|500)(\\s|$)/], TemplateElement[value.raw=/(^|\\s)text-neutral-(400|500)(\\s|$)/]",
        message:
          'text-neutral-400 (2.18:1) and text-neutral-500 (3.52:1) fail WCAG 1.4.3 for body text — use text-neutral-600 (5.9:1). Disabled/placeholder text is exempt; add an eslint-disable with the reason.',
      },
      {
        selector:
          "Literal[value=/(^|\\s)(ml|mr|pl|pr)-\\d|(^|\\s)(left|right)-\\d|(^|\\s)text-(left|right)(\\s|$)|(^|\\s)border-(l|r)(\\s|$)/], TemplateElement[value.raw=/(^|\\s)(ml|mr|pl|pr)-\\d|(^|\\s)text-(left|right)(\\s|$)/]",
        message:
          'Physical-direction utility — use the logical equivalent (ms/me, ps/pe, start/end, text-start/text-end, border-s/border-e) so the component mirrors under dir="rtl".',
      },
    ],
  },
};
