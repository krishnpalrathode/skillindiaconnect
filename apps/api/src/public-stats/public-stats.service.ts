import { Injectable } from '@nestjs/common';
import { CandidateReadService } from '../candidate/candidate-read.service';
import { EmployerService } from '../employer/employer.service';
import { JobsSearchService } from '../jobs-search/jobs-search.service';

/** The live, MEASURED platform figures behind the landing-page stats bar. */
export interface PublicStats {
  /** ACTIVE candidate profiles (suspended / pending-deletion / purged excluded). */
  candidates: number;
  /** APPROVED companies — the bar labels these "Verified Employers". */
  companies: number;
  /** Distinct countries with at least one ACTIVE job. */
  countries: number;
}

/**
 * Composes the public counts from the owning modules' PUBLIC services — it
 * issues ZERO Prisma queries of its own (module-boundaries Rule 4).
 *
 * These are raw counts only. The landing page adds its editorial baseline on
 * top in apps/web; the API never reports a number it did not measure.
 */
@Injectable()
export class PublicStatsService {
  constructor(
    private readonly candidates: CandidateReadService,
    private readonly employers: EmployerService,
    private readonly jobsSearch: JobsSearchService,
  ) {}

  async getStats(): Promise<PublicStats> {
    const [candidateCounts, companyCounts, countries] = await Promise.all([
      this.candidates.countCandidates(),
      this.employers.countByStatus(),
      // Redis-cached under the search version, so this is usually free.
      this.jobsSearch.listCountries(),
    ]);
    return {
      candidates: candidateCounts.active,
      companies: companyCounts.APPROVED ?? 0,
      countries: countries.length,
    };
  }
}
