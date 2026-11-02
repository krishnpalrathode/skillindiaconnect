import { Module, forwardRef } from '@nestjs/common';
import { CandidateModule } from '../candidate/candidate.module';
import { EmployerModule } from '../employer/employer.module';
import { JobsSearchModule } from '../jobs-search/jobs-search.module';
import { PublicStatsController } from './public-stats.controller';
import { PublicStatsService } from './public-stats.service';

/**
 * Public stats — a thin orchestration layer that OWNS NO TABLES, same shape as
 * AdminModule. Every figure comes from the owning module's exported service.
 *
 * forwardRef: Candidate and Employer sit in the existing S4-B3 module cycle, so
 * a new leaf importing them must defer the bindings (see admin.module.ts).
 */
@Module({
  imports: [
    forwardRef(() => CandidateModule),
    forwardRef(() => EmployerModule),
    JobsSearchModule,
  ],
  controllers: [PublicStatsController],
  providers: [PublicStatsService],
})
export class PublicStatsModule {}
