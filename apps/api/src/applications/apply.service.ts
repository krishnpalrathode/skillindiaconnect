import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  Application,
  DocumentType,
  NotificationType,
  Prisma,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../core/prisma/prisma.service';
import { CandidateReadService } from '../candidate/candidate-read.service';
import { JobsService, JobForApplication } from '../jobs/jobs.service';
import { EmployerService } from '../employer/employer.service';
import { SettingsService } from '../settings/settings.service';
import { SETTING_KEYS } from '../settings/settings.keys';
import { NotificationService } from '../notifications/notification.service';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS, AUDIT_MODULES, AuditStatus } from '../audit/audit.types';
import { ApplyGateService } from './apply-gate.service';
import { MatchService } from './match/match.service';
import { ApplyDto } from './dto/apply.dto';
import { ApplicationResponse, toApplicationResponse } from './application.mapper';
import {
  APPLICATION_EVENTS,
  ApplicationCreatedPayload,
} from './events/application.events';

/**
 * Apply-side in-app receipt type.
 *
 * The frozen NotificationType enum has no dedicated APPLICATION_SUBMITTED /
 * NEW_APPLICANT value, and adding one is a schema migration (explicitly out of
 * B1 scope). We reuse CANDIDATE_MATCHES as the neutral "application activity"
 * in-app type for BOTH apply-side receipts and force in-app-only delivery via
 * notifyInApp (no WhatsApp/email at apply — SELECTED's guarded send is B2). A
 * dedicated enum pair is a follow-up schema change.
 */
const APPLY_NOTIFICATION_TYPE = NotificationType.CANDIDATE_MATCHES;

@Injectable()
export class ApplyService {
  private readonly logger = new Logger(ApplyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly candidateRead: CandidateReadService,
    private readonly jobsService: JobsService,
    private readonly employerService: EmployerService,
    private readonly settingsService: SettingsService,
    private readonly applyGate: ApplyGateService,
    private readonly matchService: MatchService,
    private readonly notificationService: NotificationService,
    private readonly auditService: AuditService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async apply(
    userId: string,
    jobId: string,
    dto: ApplyDto,
    actorRole: UserRole,
  ): Promise<ApplicationResponse> {
    // 1. Resolve the applicant (they apply as themselves).
    const candidate = await this.candidateRead.getApplyInputs(userId);
    if (!candidate) {
      // A CANDIDATE token with no profile, or a non-candidate that slipped the
      // controller role check — same 403 either way.
      throw new ForbiddenException({ code: 'NOT_CANDIDATE' });
    }

    // 2. Fetch the job (throws 404 JOB_NOT_FOUND).
    const job = await this.jobsService.getJobForApplication(jobId);

    // 3. Settings — the SAME source the completion engine reads (zero drift).
    const [minCompletionPct, mandatoryDocsRaw] = await Promise.all([
      this.settingsService.get(SETTING_KEYS.MIN_COMPLETION_PCT),
      this.settingsService.get(SETTING_KEYS.MANDATORY_DOCUMENTS),
    ]);
    const mandatoryDocs = mandatoryDocsRaw as DocumentType[];

    // 4. Gate (fail-fast, locked order).
    const gate = await this.applyGate.assertCanApply(candidate, job, {
      minCompletionPct,
      mandatoryDocs,
    });

    // 5. Match — computed ONCE here and snapshotted; never recomputed.
    const match = this.matchService.compute({
      candidateCategoryId: candidate.categoryId,
      totalExperienceYears: candidate.totalExperienceYears,
      hasForeignExperience: candidate.hasForeignExperience,
      job: {
        categoryId: job.categoryId,
        market: job.market,
        experienceRequiredYears: job.experienceRequiredYears,
      },
      docsPresentCount: gate.docsPresentCount,
      docsRequiredCount: gate.docsRequiredCount,
    });

    // 6. Create in ONE insert — humanId is DB-assigned (AP-YYYY-N), NEVER set here.
    let application: Application;
    try {
      application = await this.prisma.application.create({
        data: {
          jobId: job.id,
          candidateId: candidate.candidateId,
          status: 'PENDING',
          coverLetter: dto.coverLetter ?? null,
          matchScore: match.score,
          matchBreakdown: match.breakdown as unknown as Prisma.InputJsonValue,
          docsCompleteCount: gate.docsPresentCount,
          docsRequiredCount: gate.docsRequiredCount,
          passportValidAtApply: true, // it passed gate 5
        },
      });
    } catch (err) {
      // Race guarantee: a concurrent double-submit hits the (jobId, candidateId)
      // unique → P2002. Map to the SAME 409 as the gate-2 pre-check so a parallel
      // double-apply is indistinguishable from a sequential one to the client.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException({ code: 'ALREADY_APPLIED' });
      }
      throw err;
    }

    // 7. Side effects — after the insert, best-effort (never fail a committed apply).
    await this.fireSideEffects(application, job, userId, actorRole);

    return toApplicationResponse(application);
  }

  /**
   * Fire-safe post-insert side effects: domain event, both in-app receipts, audit.
   * The application is already committed — a notification/audit hiccup must not
   * turn a successful apply into a 500 (the client would retry into ALREADY_APPLIED).
   */
  private async fireSideEffects(
    application: Application,
    job: JobForApplication,
    candidateUserId: string,
    actorRole: UserRole,
  ): Promise<void> {
    // Domain event (same-process; e.g. future match-feed / analytics reactions).
    const payload: ApplicationCreatedPayload = {
      applicationId: application.id,
      jobId: job.id,
      candidateId: application.candidateId as string,
      companyId: job.companyId,
    };
    this.eventEmitter.emit(APPLICATION_EVENTS.CREATED, payload);

    // In-app receipts — in-app tier only (no WhatsApp/email at apply).
    try {
      await this.notificationService.notifyInApp(candidateUserId, APPLY_NOTIFICATION_TYPE, {
        title: 'Application submitted',
        body: `Your application to ${job.title} was submitted.`,
        data: { applicationId: application.id, jobId: job.id },
      });

      const employerUserId = await this.employerService.getPrimaryUserIdForCompany(
        job.companyId,
      );
      if (employerUserId) {
        await this.notificationService.notifyInApp(employerUserId, APPLY_NOTIFICATION_TYPE, {
          title: 'New applicant',
          body: `New applicant for ${job.title}.`,
          data: { applicationId: application.id, jobId: job.id },
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`apply side-effect notification failed for ${application.id}: ${msg}`);
    }

    // Audit — ids-only meta (no PII). auditService.log is itself fire-safe.
    await this.auditService.log({
      actorUserId: candidateUserId,
      actorRole,
      action: AUDIT_ACTIONS.APPLICATION_CREATED,
      module: AUDIT_MODULES.APPLICATIONS,
      targetType: 'Application',
      targetId: application.id,
      status: AuditStatus.SUCCESS,
      meta: { jobId: job.id, candidateId: application.candidateId, companyId: job.companyId },
    });
  }
}
