import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeEach } from 'vitest';
import { server } from '../../../mocks/server';
import { http, HttpResponse } from 'msw';
import { db, makeAccessToken, EMPLOYER_APPROVED_USER_ID } from '../../../mocks/data';
import { setAccessToken, resetClient } from '../../../lib/api/client';
import { getMyJob } from '../../../lib/api/jobs-employer';

/**
 * Editing a job the employer OWNS must work at every editable status.
 *
 * THE BUG THIS PINS: the edit screen loaded through the PUBLIC `GET /jobs/{id}`,
 * which serves only publicly-visible jobs. An ACTIVE job loaded, so the screen
 * looked correct in every casual check — but a DRAFT or PAUSED job came back 404
 * and the page fell straight through to its "couldn't load" state. Edit was
 * broken for exactly the jobs an employer most needs to edit: the ones not live
 * yet.
 *
 * Tested at the API-call boundary rather than by rendering the page, because
 * that IS the defect — the screen asked the wrong endpoint. Rendering the whole
 * edit page would drag in JobForm's category fetches and live preview to assert
 * a fact about one URL, and would fail for reasons unrelated to it.
 */

const BASE = '/api/v1';

beforeEach(() => {
  resetClient();
  // The mock resolves the bearer token through db.sessions, so registering the
  // session is part of "being logged in" — setting the client token alone
  // yields 401 from every handler.
  const token = makeAccessToken(EMPLOYER_APPROVED_USER_ID);
  setAccessToken(token);
  db.sessions.set(token, { userId: EMPLOYER_APPROVED_USER_ID, accessToken: token });
});

describe('getMyJob — the read behind the edit screen', () => {
  it.each(['DRAFT', 'PAUSED', 'ACTIVE'] as const)('loads an owned %s job', async (status) => {
    const job = db.jobs.get('job-4')!;
    const original = job.status;
    job.status = status;
    try {
      const loaded = await getMyJob('job-4');
      expect(loaded.title).toBe(job.title);
      expect(loaded.status).toBe(status);
    } finally {
      job.status = original;
    }
  });

  it('requests the EMPLOYER-scoped route, never the public one', async () => {
    /*
      The regression guard. The public route answers for ACTIVE jobs, so a test
      that only asserts "a job came back" would still pass if this moved back
      onto `/jobs/{id}` — and DRAFT/PAUSED would silently break again.
    */
    const seen: string[] = [];
    server.use(
      http.get(`${BASE}/jobs/:id`, ({ params }) => {
        seen.push(`PUBLIC /jobs/${params['id'] as string}`);
        return HttpResponse.json({ data: db.jobs.get(params['id'] as string) });
      }),
      http.get(`${BASE}/employers/me/jobs/:id`, ({ params }) => {
        seen.push(`SCOPED /employers/me/jobs/${params['id'] as string}`);
        return HttpResponse.json({ data: db.jobs.get(params['id'] as string) });
      }),
    );

    await getMyJob('job-4');
    expect(seen).toEqual(['SCOPED /employers/me/jobs/job-4']);
  });

  it('still surfaces a genuine 404 rather than papering over it', async () => {
    server.use(
      http.get(`${BASE}/employers/me/jobs/:id`, () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Not found', status: 404, code: 'NOT_FOUND', detail: '' },
          { status: 404 },
        ),
      ),
    );
    await expect(getMyJob('job-4')).rejects.toMatchObject({ error: { status: 404 } });
  });
});

describe('the edit page wiring', () => {
  const source = readFileSync(
    join(__dirname, '../../../app/[locale]/employer/jobs/[id]/edit/page.tsx'),
    'utf8',
  );

  it('reads through getMyJob and not a hand-rolled public /jobs fetch', () => {
    expect(source).toContain('getMyJob');
    // The exact shape that was wrong. Checked in the SOURCE because the render
    // path is not where the mistake lives — the import is.
    expect(source).not.toMatch(/apiFetch<Job>\(\s*`\/jobs\//);
  });
});
