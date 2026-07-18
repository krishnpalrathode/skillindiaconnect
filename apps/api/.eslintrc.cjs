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
          // applications module (S4): other modules must not import its internals.
          // The apply flow is reached only over HTTP (POST /jobs/:id/apply) in B1;
          // B2/B3 will export a service seam. Zone the orchestrator + gate + engine.
          {
            target: './src/auth',
            from: './src/applications/apply.service.ts',
            message: 'Applications has no public seam yet — do not import apply.service.',
          },
          {
            target: './src/candidate',
            from: './src/applications/apply.service.ts',
            message: 'Applications has no public seam yet — do not import apply.service.',
          },
          {
            target: './src/jobs',
            from: './src/applications/apply.service.ts',
            message: 'Applications has no public seam yet — do not import apply.service.',
          },
          {
            target: './src/employer',
            from: './src/applications/apply.service.ts',
            message: 'Applications has no public seam yet — do not import apply.service.',
          },
          {
            target: './src/notifications',
            from: './src/applications/apply.service.ts',
            message: 'Applications has no public seam yet — do not import apply.service.',
          },
          {
            target: './src/settings',
            from: './src/applications/apply.service.ts',
            message: 'Applications has no public seam yet — do not import apply.service.',
          },
          {
            target: './src/audit',
            from: './src/applications/apply.service.ts',
            message: 'Applications has no public seam yet — do not import apply.service.',
          },
          // B3: the read + status + aggregate INTERNALS are private. The ONLY public
          // seam for other modules is ApplicationsAggregateService (dashboards/My-Jobs).
          // Other modules must never import the read service, status service, or the
          // controllers/mappers — no applications-table access outside this module.
          {
            target: './src/candidate',
            from: './src/applications/applications-read.service.ts',
            message: 'Use ApplicationsAggregateService — never import the read service.',
          },
          {
            target: './src/jobs',
            from: './src/applications/applications-read.service.ts',
            message: 'Use ApplicationsAggregateService — never import the read service.',
          },
          {
            target: './src/employer',
            from: './src/applications/applications-read.service.ts',
            message: 'Use ApplicationsAggregateService — never import the read service.',
          },
          {
            target: './src/candidate',
            from: './src/applications/status.service.ts',
            message: 'Applications status transitions are internal (B2) — do not import.',
          },
          {
            target: './src/jobs',
            from: './src/applications/status.service.ts',
            message: 'Applications status transitions are internal (B2) — do not import.',
          },
          {
            target: './src/employer',
            from: './src/applications/status.service.ts',
            message: 'Applications status transitions are internal (B2) — do not import.',
          },
          // ── S6a-B1: the admin zone ──────────────────────────────────────────
          // The admin module OWNS NO TABLES. It composes other modules' PUBLIC
          // service exports only — never their controllers, DTOs, mappers or
          // internal providers. If an admin screen needs a figure that doesn't
          // exist, add a narrow read to the OWNING module; do not reach in here.
          {
            target: './src/admin',
            from: './src/applications/status.service.ts',
            message: 'Applications status transitions are internal (B2) — do not import.',
          },
          {
            target: './src/admin',
            from: './src/audit/audit.subscriber.ts',
            message: 'Use AuditService.log() — never import the audit subscriber directly.',
          },
          {
            target: './src/admin',
            from: './src/settings/settings.controller.ts',
            message: 'Use SettingsService — never import the settings controller directly.',
          },
          {
            target: './src/admin',
            from: './src/jobs/publish-guard.service.ts',
            message:
              'The publish gate is internal to Jobs — admin composes JobsService, not its guards.',
          },
          {
            target: './src/admin',
            from: './src/employer/employer-approval.service.ts',
            message:
              'Employer approval is an S2-B4 mutation surface — S6a-B1 is read-only; do not import.',
          },
          // ── Resume module (S7-B1/B2) ─────────────────────────────────────
          // The rendering half is WORKER-ONLY: PdfModule carries Chromium, so
          // an API-side import would put a browser in every API replica. The
          // structural spec proves the closure; this zone catches it at lint
          // time, where the fix is cheap.
          {
            target: './src/resume/resume.module.ts',
            from: './src/pdf',
            message:
              'Chromium is worker-only — the API-side ResumeModule must never import PdfModule.',
          },
          {
            target: './src/resume/resume.controller.ts',
            from: './src/resume/resume-render.service.ts',
            message: 'The renderer runs in the worker — the controller enqueues, never renders.',
          },
          {
            target: './src/candidate',
            from: './src/resume/resume.controller.ts',
            message: 'Use ResumeService — never import the resume controller directly.',
          },
          {
            target: './src/notifications',
            from: './src/resume/resume.controller.ts',
            message: 'Use ResumeService — never import the resume controller directly.',
          },
        ],
      },
    ],
  },
  ignorePatterns: ['dist/', 'node_modules/'],
};
