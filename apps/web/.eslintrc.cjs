/** @type {import('eslint').Linter.Config} */
module.exports = {
  extends: ['next/core-web-vitals', '../../.eslintrc.cjs'],
  rules: {
    // next/core-web-vitals provides its own parser options; relax the TypeScript
    // project requirement for JSX files that next lint handles.
    '@typescript-eslint/explicit-module-boundary-types': 'off',
  },
};
