import { Module } from '@nestjs/common';
import { CandidateModule } from '../candidate/candidate.module';
import { JobsModule } from '../jobs/jobs.module';
import { EmployerModule } from '../employer/employer.module';
import { SettingsModule } from '../settings/settings.module';
import { NotificationModule } from '../notifications/notification.module';
import { ApplyController } from './apply.controller';
import { ApplyService } from './apply.service';
import { ApplyGateService } from './apply-gate.service';
import { MatchService } from './match/match.service';

/**
 * Applications module (S4-B1).
 *
 * Owns the `applications` table (and, from B2, timeline + notes). It reads
 * candidate data ONLY via CandidateReadService and job data ONLY via JobsService,
 * and resolves the employer notification target via EmployerService — never
 * querying those modules' tables directly (module-boundaries.md Rule 4).
 *
 * B1 exposes a single write surface: POST /jobs/:id/apply. Read/list endpoints
 * (B3) and status transitions (B2) land next.
 *
 * AuditModule + CoreModule (Prisma) + EventEmitter are @Global — auto-injectable.
 */
@Module({
  imports: [
    CandidateModule, // CandidateReadService.getApplyInputs
    JobsModule, // JobsService.getJobForApplication
    EmployerModule, // EmployerService.getPrimaryUserIdForCompany
    SettingsModule, // MIN_COMPLETION_PCT + MANDATORY_DOCUMENTS
    NotificationModule, // NotificationService.notifyInApp (in-app receipts)
  ],
  controllers: [ApplyController],
  providers: [ApplyService, ApplyGateService, MatchService],
})
export class ApplicationsModule {}
