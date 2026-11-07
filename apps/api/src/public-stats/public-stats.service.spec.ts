/**
 * Public stats composition: the right figure is picked from each owning
 * module's service, and nothing is padded — the baseline lives in apps/web.
 */
import { CandidateReadService } from '../candidate/candidate-read.service';
import { EmployerService } from '../employer/employer.service';
import { JobsSearchService } from '../jobs-search/jobs-search.service';
import { PublicStatsService } from './public-stats.service';

function build(opts: {
  candidates: { total: number; active: number };
  companies: Record<string, number>;
  countries: Array<{ country: string; count: number }>;
}) {
  const candidates = {
    countCandidates: jest.fn().mockResolvedValue(opts.candidates),
  } as unknown as CandidateReadService;
  const employers = {
    countByStatus: jest.fn().mockResolvedValue(opts.companies),
  } as unknown as EmployerService;
  const jobsSearch = {
    listCountries: jest.fn().mockResolvedValue(opts.countries),
  } as unknown as JobsSearchService;
  return new PublicStatsService(candidates, employers, jobsSearch);
}

describe('PublicStatsService', () => {
  it('reports ACTIVE candidates, APPROVED companies and countries with live jobs', async () => {
    const service = build({
      candidates: { total: 12, active: 9 },
      companies: { PENDING: 4, APPROVED: 3, REJECTED: 1, SUSPENDED: 2 },
      countries: [
        { country: 'India', count: 5 },
        { country: 'Oman', count: 1 },
      ],
    });

    await expect(service.getStats()).resolves.toEqual({
      candidates: 9,
      companies: 3,
      countries: 2,
    });
  });

  it('reports honest zeros on an empty platform', async () => {
    const service = build({
      candidates: { total: 0, active: 0 },
      companies: { PENDING: 0, APPROVED: 0, REJECTED: 0, SUSPENDED: 0 },
      countries: [],
    });

    await expect(service.getStats()).resolves.toEqual({
      candidates: 0,
      companies: 0,
      countries: 0,
    });
  });
});
