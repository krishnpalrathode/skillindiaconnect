/**
 * S8-H4 — THE screen inventory under audit.
 *
 * Scope rules from the unit brief:
 *   - user-facing (candidate / employer / public) → FULL RTL + a11y audit
 *   - admin → a11y audit ONLY (EN-only by product decision, no RTL work)
 *
 * `auth` states which session the screen needs; the harness seeds the matching
 * localStorage/cookie before navigating. Screens are listed with the concrete
 * ids MSW serves, because auditing an empty state proves nothing about a dense
 * grid — the leak spots only appear when there is content to mirror.
 */

export type Audience = 'public' | 'candidate' | 'employer' | 'admin';

export interface Screen {
  /** Stable id used in report tables and result JSON. */
  id: string;
  /** Path WITHOUT the locale prefix; the harness prepends /en or /ar. */
  path: string;
  audience: Audience;
  /** Human name for the report. */
  name: string;
  /** Screens the brief flagged as RTL leak spots — audited with extra checks. */
  leakSpot?: string;
  /** Skip RTL for admin (EN-only by decision). */
  rtl: boolean;
}

export const SCREENS: Screen[] = [
  // ── Public ──────────────────────────────────────────────────────────────
  { id: 'landing', path: '/', audience: 'public', name: 'Landing', rtl: true },
  { id: 'jobs-list', path: '/jobs', audience: 'public', name: 'Job search', rtl: true, leakSpot: 'job cards: benefit chips, badges, salary+currency' },
  { id: 'job-detail', path: '/jobs/job-1', audience: 'public', name: 'Job detail', rtl: true, leakSpot: 'salary/currency, benefit chips' },
  { id: 'login', path: '/login', audience: 'public', name: 'Candidate login', rtl: true },
  { id: 'signup', path: '/signup', audience: 'public', name: 'Candidate signup', rtl: true },
  { id: 'forgot-password', path: '/forgot-password', audience: 'public', name: 'Forgot password', rtl: true },
  { id: 'employer-login', path: '/employer-login', audience: 'public', name: 'Employer login', rtl: true },

  // ── Candidate ───────────────────────────────────────────────────────────
  { id: 'onboarding', path: '/onboarding', audience: 'candidate', name: 'Candidate onboarding (stepper)', rtl: true, leakSpot: 'stepper direction + next/back affordances' },
  { id: 'dashboard', path: '/dashboard', audience: 'candidate', name: 'Candidate dashboard', rtl: true, leakSpot: 'completion ring + label' },
  { id: 'profile', path: '/profile', audience: 'candidate', name: 'Candidate profile', rtl: true, leakSpot: 'completion ring, uploads' },
  { id: 'applications', path: '/applications', audience: 'candidate', name: 'My applications', rtl: true },
  { id: 'application-detail', path: '/applications/app-1', audience: 'candidate', name: 'Application detail (timeline)', rtl: true, leakSpot: 'Screen 08 timeline: connector side + directional flow' },
  { id: 'notifications', path: '/notifications', audience: 'candidate', name: 'Notifications', rtl: true },

  // ── Employer ────────────────────────────────────────────────────────────
  { id: 'employer-onboarding', path: '/employer/onboarding', audience: 'employer', name: 'Employer onboarding', rtl: true, leakSpot: 'stepper direction' },
  { id: 'employer-dashboard', path: '/employer/dashboard', audience: 'employer', name: 'Employer dashboard', rtl: true },
  { id: 'employer-jobs', path: '/employer/jobs', audience: 'employer', name: 'Employer jobs list', rtl: true },
  { id: 'employer-job-new', path: '/employer/jobs/new', audience: 'employer', name: 'Job form + live preview (Screen 16)', rtl: true, leakSpot: 'mirrored two-column layout — columns must swap' },
  { id: 'employer-applicants', path: '/employer/jobs/job-1/applicants', audience: 'employer', name: 'Applicants table', rtl: true, leakSpot: 'dense table + match scores' },
  { id: 'employer-candidates', path: '/employer/candidates', audience: 'employer', name: 'Candidate browse', rtl: true, leakSpot: 'candidate cards' },
  { id: 'employer-candidate-detail', path: '/employer/candidates/cand-1', audience: 'employer', name: 'Candidate detail', rtl: true, leakSpot: 'mirrored two-column layout' },
  { id: 'employer-profile', path: '/employer/profile', audience: 'employer', name: 'Employer profile', rtl: true, leakSpot: 'mirrored two-column layout, uploads' },
  { id: 'employer-subscription', path: '/employer/subscription', audience: 'employer', name: 'Subscription / billing', rtl: true, leakSpot: 'currency amounts' },

  // ── Admin (a11y only — EN-only by decision) ─────────────────────────────
  { id: 'admin-dashboard', path: '/admin/dashboard', audience: 'admin', name: 'Admin dashboard', rtl: false },
  { id: 'admin-roles', path: '/admin/roles', audience: 'admin', name: 'RBAC matrix (Screen 27)', rtl: false },
  { id: 'admin-logs', path: '/admin/logs', audience: 'admin', name: 'Log explorer', rtl: false },
  { id: 'admin-candidates', path: '/admin/candidates', audience: 'admin', name: 'Admin candidates', rtl: false },
  { id: 'admin-candidate-detail', path: '/admin/candidates/cand-1', audience: 'admin', name: 'Admin candidate detail', rtl: false },
  { id: 'admin-employers', path: '/admin/employers', audience: 'admin', name: 'Admin employers', rtl: false },
  { id: 'admin-jobs', path: '/admin/jobs', audience: 'admin', name: 'Admin jobs (moderation)', rtl: false },
  { id: 'admin-applications', path: '/admin/applications', audience: 'admin', name: 'Admin applications', rtl: false },
  { id: 'admin-application-detail', path: '/admin/applications/app-1', audience: 'admin', name: 'Admin application detail (timeline)', rtl: false },
  { id: 'admin-settings', path: '/admin/settings', audience: 'admin', name: 'Platform settings', rtl: false },
];

export const RTL_SCREENS = SCREENS.filter((s) => s.rtl);
