'use strict';

/**
 * ESLint config for apps/api.
 *
 * Module-boundary enforcement (Rule 3 in .claude/rules/module-boundaries.md):
 * Each module's internal files are zoned off from other modules via
 * import/no-restricted-paths. Other modules must import ONLY a module's
 * exported service — never its controller, repository, or internal providers.
 *
 * Add one zone entry per new module. When this list grows beyond ~5 modules,
 * migrate to eslint-plugin-boundaries (one element-type rule auto-applies to all).
 */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: './tsconfig.json',
    tsconfigRootDir: __dirname,
  },
  plugins: ['@typescript-eslint', 'import'],
  extends: ['plugin:@typescript-eslint/recommended'],
  rules: {
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],

    // ── Module boundary zones ────────────────────────────────────────────────
    // Prevents a module from importing another module's internals directly.
    // Only the exported service is the public seam — never the controller,
    // module file, or internal providers.
    'import/no-restricted-paths': [
      'error',
      {
        zones: [
          // settings module: other modules must use SettingsService, not import
          // settings.controller or settings.module directly.
          {
            target: './src/auth',
            from: './src/settings/settings.controller.ts',
            message: 'Use SettingsService — never import the settings controller directly.',
          },
          {
            target: './src/candidate',
            from: './src/settings/settings.controller.ts',
            message: 'Use SettingsService — never import the settings controller directly.',
          },
          {
            target: './src/account',
            from: './src/settings/settings.controller.ts',
            message: 'Use SettingsService — never import the settings controller directly.',
          },
          {
            target: './src/health',
            from: './src/settings/settings.controller.ts',
            message: 'Use SettingsService — never import the settings controller directly.',
          },
          {
            target: './src/notifications',
            from: './src/settings/settings.controller.ts',
            message: 'Use SettingsService — never import the settings controller directly.',
          },
          {
            target: './src/queue',
            from: './src/settings/settings.controller.ts',
            message: 'Use SettingsService — never import the settings controller directly.',
          },
          // audit module: other modules must inject AuditService (exported from AuditModule).
          // Never import audit.subscriber.ts or audit.module.ts directly.
          {
            target: './src/auth',
            from: './src/audit/audit.subscriber.ts',
            message: 'Use AuditService.log() — never import the audit subscriber directly.',
          },
          {
            target: './src/candidate',
            from: './src/audit/audit.subscriber.ts',
            message: 'Use AuditService.log() — never import the audit subscriber directly.',
          },
          {
            target: './src/account',
            from: './src/audit/audit.subscriber.ts',
            message: 'Use AuditService.log() — never import the audit subscriber directly.',
          },
          {
            target: './src/settings',
            from: './src/audit/audit.subscriber.ts',
            message: 'Use AuditService.log() — never import the audit subscriber directly.',
          },
          {
            target: './src/notifications',
            from: './src/audit/audit.subscriber.ts',
            message: 'Use AuditService.log() — never import the audit subscriber directly.',
          },
          // notifications module: other modules must inject NotificationService, not import
          // notification.processor.ts, notification.worker-module.ts, or the subscriber.
          {
            target: './src/auth',
            from: './src/notifications/notification.processor.ts',
            message: 'Use NotificationService.notify() — never import the processor directly.',
          },
          {
            target: './src/candidate',
            from: './src/notifications/notification.processor.ts',
            message: 'Use NotificationService.notify() — never import the processor directly.',
          },
          {
            target: './src/account',
            from: './src/notifications/notification.processor.ts',
            message: 'Use NotificationService.notify() — never import the processor directly.',
          },
          {
            target: './src/settings',
            from: './src/notifications/notification.processor.ts',
            message: 'Use NotificationService.notify() — never import the processor directly.',
          },
          {
            target: './src/audit',
            from: './src/notifications/notification.processor.ts',
            message: 'Use NotificationService.notify() — never import the processor directly.',
          },
          {
            target: './src/queue',
            from: './src/notifications/notification.processor.ts',
            message: 'Use NotificationService.notify() — never import the processor directly.',
          },
          {
            target: './src/queue',
            from: './src/audit/audit.subscriber.ts',
            message: 'Use AuditService.log() — never import the audit subscriber directly.',
          },
          // jobs module: other modules must inject JobsService (exported).
          // Never import jobs.controller, publish-guard.service, or job-lifecycle.service directly.
          {
            target: './src/auth',
            from: './src/jobs/publish-guard.service.ts',
            message: 'Use JobsService — never import the publish guard directly.',
          },
          {
            target: './src/candidate',
            from: './src/jobs/publish-guard.service.ts',
            message: 'Use JobsService — never import the publish guard directly.',
          },
          {
            target: './src/notifications',
            from: './src/jobs/publish-guard.service.ts',
            message: 'Use JobsService — never import the publish guard directly.',
          },
          {
            target: './src/settings',
            from: './src/jobs/publish-guard.service.ts',
            message: 'Use JobsService — never import the publish guard directly.',
          },
          {
            target: './src/employer',
            from: './src/jobs/publish-guard.service.ts',
            message: 'Use JobsService — never import the publish guard directly.',
          },
          {
            target: './src/audit',
            from: './src/jobs/publish-guard.service.ts',
            message: 'Use JobsService — never import the publish guard directly.',
          },
          // jobs-search module: other modules must not import internal search services.
          // SearchCacheService and SavedJobsService are internal to this module.
          {
            target: './src/auth',
            from: './src/jobs-search/search-cache.service.ts',
            message: 'Use JobsSearchService — never import search-cache service directly.',
          },
          {
            target: './src/candidate',
            from: './src/jobs-search/search-cache.service.ts',
            message: 'Use JobsSearchService — never import search-cache service directly.',
          },
          {
            target: './src/jobs',
            from: './src/jobs-search/search-cache.service.ts',
            message: 'Use JobsSearchService — never import search-cache service directly.',
          },
          {
            target: './src/employer',
            from: './src/jobs-search/search-cache.service.ts',
            message: 'Use JobsSearchService — never import search-cache service directly.',
          },
          {
            target: './src/settings',
            from: './src/jobs-search/search-cache.service.ts',
            message: 'Use JobsSearchService — never import search-cache service directly.',
          },
          {
            target: './src/notifications',
            from: './src/jobs-search/search-cache.service.ts',
            message: 'Use JobsSearchService — never import search-cache service directly.',
          },
          // employer module: other modules must inject EmployerService (exported).
          // Never import admin-employer.controller or employer-approval.service directly.
          {
            target: './src/auth',
            from: './src/employer/employer-approval.service.ts',
            message: 'Use EmployerService — never import the approval service directly.',
          },
          {
            target: './src/candidate',
            from: './src/employer/employer-approval.service.ts',
            message: 'Use EmployerService — never import the approval service directly.',
          },
          {
            target: './src/notifications',
            from: './src/employer/employer-approval.service.ts',
            message: 'Use EmployerService — never import the approval service directly.',
          },
          {
            target: './src/settings',
            from: './src/employer/employer-approval.service.ts',
            message: 'Use EmployerService — never import the approval service directly.',
          },
          {
            target: './src/audit',
            from: './src/employer/employer-approval.service.ts',
            message: 'Use EmployerService — never import the approval service directly.',
          },
          {
            target: './src/queue',
            from: './src/employer/employer-approval.service.ts',
            message: 'Use EmployerService — never import the approval service directly.',
          },
        ],
      },
    ],
  },
  ignorePatterns: ['dist/', 'node_modules/'],
};
