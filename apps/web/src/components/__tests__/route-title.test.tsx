import { describe, it, expect } from 'vitest';
import { documentTitle } from '../RouteTitle';

const BRAND = 'SkillIndiaConnect';

describe('documentTitle — Brand | Section | Page for every route', () => {
  it.each([
    // home → brand only
    ['/en', 'SkillIndiaConnect'],
    ['/en/', 'SkillIndiaConnect'],
    // candidate app (no section prefix — the primary app)
    ['/en/applications', 'SkillIndiaConnect | Applications'],
    ['/en/applications/abc123', 'SkillIndiaConnect | Application'],
    ['/en/dashboard', 'SkillIndiaConnect | Dashboard'],
    ['/en/jobs', 'SkillIndiaConnect | Jobs'],
    ['/en/jobs/xyz', 'SkillIndiaConnect | Job details'],
    ['/en/notifications', 'SkillIndiaConnect | Notifications'],
    ['/en/profile', 'SkillIndiaConnect | Profile'],
    // auth + public
    ['/en/login', 'SkillIndiaConnect | Log in'],
    ['/en/signup', 'SkillIndiaConnect | Sign up'],
    ['/en/forgot-password', 'SkillIndiaConnect | Reset password'],
    ['/en/employer-login', 'SkillIndiaConnect | Employer log in'],
    ['/en/about', 'SkillIndiaConnect | About'],
    ['/en/privacy', 'SkillIndiaConnect | Privacy policy'],
    // admin (3-level)
    ['/en/admin/dashboard', 'SkillIndiaConnect | Admin | Dashboard'],
    ['/en/admin/employers', 'SkillIndiaConnect | Admin | Employers'],
    ['/en/admin/employers/id-1', 'SkillIndiaConnect | Admin | Employer'],
    ['/en/admin/jobs/new', 'SkillIndiaConnect | Admin | Post job'],
    ['/en/admin/logs', 'SkillIndiaConnect | Admin | Audit log'],
    ['/en/admin/roles', 'SkillIndiaConnect | Admin | Roles & permissions'],
    // employer portal (3-level)
    ['/en/employer/dashboard', 'SkillIndiaConnect | Employer | Dashboard'],
    ['/en/employer/candidates/c-1', 'SkillIndiaConnect | Employer | Candidate'],
    ['/en/employer/jobs/j-1/applicants', 'SkillIndiaConnect | Employer | Applicants'],
    ['/en/employer/jobs/j-1/edit', 'SkillIndiaConnect | Employer | Edit job'],
  ])('%s → %s', (path, expected) => {
    expect(documentTitle(path, BRAND)).toBe(expected);
  });

  it('strips any supported locale prefix (hi/ar) the same way', () => {
    expect(documentTitle('/hi/admin/dashboard', 'ब्रांड')).toBe('ब्रांड | Admin | Dashboard');
    expect(documentTitle('/ar/applications', 'براند')).toBe('براند | Applications');
  });
});
