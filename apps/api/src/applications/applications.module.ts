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
import { StatusController } from './status.controller';
import { AdminStatusController } from './admin-status.controller';
import { StatusService } from './status.service';

/**
 * Applications module (S4-B1 apply + B2 transitions).
 *
 * Owns `applications` + `application_timeline` (notes stay for S6). It reads
 * candidate data ONLY via CandidateReadService and job data ONLY via JobsService,
 * and resolves employer/company via EmployerService — never querying those
 * modules' tables directly (module-boundaries.md Rule 4).
 *
 * Write surfaces: POST /jobs/:id/apply (B1); PATCH /applications/:id/status
 * (employer) + PATCH /admin/applications/:id/status (admin override) (B2). The
 * admin route is RBAC-gated by the global PermissionsGuard (applications.change_status).
 *
 * AuditModule + CoreModule (Prisma) + EventEmitter are @Global — auto-injectable.
 */
@Module({
  imports: [
    CandidateModule, // CandidateReadService (apply inputs + candidate userId)
    JobsModule, // JobsService (job read for apply + employer scoping)
    EmployerModule, // EmployerService (company resolution + notify target)
    SettingsModule, // MIN_COMPLETION_PCT + MANDATORY_DOCUMENTS
    NotificationModule, // NotificationService (receipts + status notifications)
  ],
  controllers: [ApplyController, StatusController, AdminStatusController],
  providers: [ApplyService, ApplyGateService, MatchService, StatusService],
})
export class ApplicationsModule {}
