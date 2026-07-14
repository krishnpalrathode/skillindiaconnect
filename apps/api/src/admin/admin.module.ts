import { Module, forwardRef } from '@nestjs/common';
import { CandidateModule } from '../candidate/candidate.module';
import { EmployerModule } from '../employer/employer.module';
import { JobsModule } from '../jobs/jobs.module';
import { ApplicationsModule } from '../applications/applications.module';
import { SubscriptionReadModule } from '../payments/subscription-read.module';
import { AccountModule } from '../account/account.module';
import { AdminDashboardController } from './admin-dashboard.controller';
import { AdminDashboardService } from './admin-dashboard.service';
import { AdminDocumentsController } from './admin-documents.controller';
import { AdminDocumentsService } from './admin-documents.service';
import { AdminCandidatesController } from './admin-candidates.controller';
import { AdminCandidatesService } from './admin-candidates.service';

/**
 * The admin module (S6a-B1) — a THIN ORCHESTRATION LAYER that OWNS NO TABLES.
 *
 * Everything here composes other modules' PUBLIC service exports:
 *   - CandidateReadService        → candidate counts, candidate document keys
 *   - EmployerService             → company counts, registration-certificate keys
 *   - JobsService                 → job counts (incl. the PENDING_REVIEW queue)
 *   - ApplicationsAggregateService→ application counts
 *   - SubscriptionReadService     → revenue invoiced this month
 *   - StorageService (@Global R2) → presignGet, reused from S5-B3
 *   - AuditService  (@Global)     → the per-issuance document.viewed rows
 *
 * It issues ZERO Prisma queries of its own (module-boundaries Rule 4). If a new
 * admin screen needs a figure that doesn't exist yet, the correct move is a
 * narrow read on the OWNING module — never a query in here. The ESLint zone in
 * .eslintrc.cjs enforces that this module never reaches into another module's
 * internals.
 *
 * NOTE the audit-log query is NOT here — it lives with the audit module, which
 * owns audit_logs. Same rule, applied consistently.
 *
 * forwardRef: these feature modules already form a cycle among themselves
 * (Candidate ↔ Applications ↔ Jobs ↔ Employer, from S4-B3); importing them from a
 * new leaf module joins that graph, so the bindings must be deferred.
 */
@Module({
  imports: [
    forwardRef(() => CandidateModule),
    forwardRef(() => EmployerModule),
    forwardRef(() => JobsModule),
    forwardRef(() => ApplicationsModule),
    SubscriptionReadModule,
    // S6b-B1: user-lifecycle writes (suspend/reactivate/purge-mark) go through
    // AccountService — the account module owns the users lifecycle columns.
    AccountModule,
  ],
  controllers: [AdminDashboardController, AdminDocumentsController, AdminCandidatesController],
  providers: [AdminDashboardService, AdminDocumentsService, AdminCandidatesService],
})
export class AdminModule {}
