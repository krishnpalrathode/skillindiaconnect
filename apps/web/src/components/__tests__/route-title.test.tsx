import { describe, it, expect } from 'vitest';
import { documentTitle } from '../RouteTitle';

const BRAND = 'Skill India Connect';

describe('documentTitle — Brand | Section | Page for every route', () => {
  it.each([
    // home → brand only
    ['/en', 'Skill India Connect'],
    ['/en/', 'Skill India Connect'],
    // candidate app (no section prefix — the primary app)
    ['/en/applications', 'Skill India Connect | Applications'],
    ['/en/applications/abc123', 'Skill India Connect | Application'],
    ['/en/dashboard', 'Skill India Connect | Dashboard'],
    ['/en/jobs', 'Skill India Connect | Jobs'],
    ['/en/jobs/xyz', 'Skill India Connect | Job details'],
    ['/en/notifications', 'Skill India Connect | Notifications'],
    ['/en/profile', 'Skill India Connect | Profile'],
    // auth + public
    ['/en/login', 'Skill India Connect | Log in'],
    ['/en/signup', 'Skill India Connect | Sign up'],
    ['/en/forgot-password', 'Skill India Connect | Reset password'],
    ['/en/employer-login', 'Skill India Connect | Employer log in'],
    ['/en/about', 'Skill India Connect | About'],
    ['/en/privacy', 'Skill India Connect | Privacy policy'],
    // admin (3-level)
    ['/en/admin/dashboard', 'Skill India Connect | Admin | Dashboard'],
    ['/en/admin/employers', 'Skill India Connect | Admin | Employers'],
    ['/en/admin/employers/id-1', 'Skill India Connect | Admin | Employer'],
    ['/en/admin/jobs/new', 'Skill India Connect | Admin | Post job'],
    ['/en/admin/logs', 'Skill India Connect | Admin | Audit log'],
    ['/en/admin/roles', 'Skill India Connect | Admin | Roles & permissions'],
    // employer portal (3-level)
    ['/en/employer/dashboard', 'Skill India Connect | Employer | Dashboard'],
    ['/en/employer/candidates/c-1', 'Skill India Connect | Employer | Candidate'],
    ['/en/employer/jobs/j-1/applicants', 'Skill India Connect | Employer | Applicants'],
    ['/en/employer/jobs/j-1/edit', 'Skill India Connect | Employer | Edit job'],
  ])('%s → %s', (path, expected) => {
    expect(documentTitle(path, BRAND)).toBe(expected);
  });

  it('strips any supported locale prefix (hi/ar) the same way', () => {
    expect(documentTitle('/hi/admin/dashboard', 'ब्रांड')).toBe('ब्रांड | Admin | Dashboard');
    expect(documentTitle('/ar/applications', 'براند')).toBe('براند | Applications');
  });
});
