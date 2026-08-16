import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Application, ApplicationStatus, NotificationType, UserRole } from '@prisma/client';
import { PrismaService } from '../core/prisma/prisma.service';
import { JobsService } from '../jobs/jobs.service';
import { CandidateReadService } from '../candidate/candidate-read.service';
import { NotificationService } from '../notifications/notification.service';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS, AUDIT_MODULES, AuditStatus } from '../audit/audit.types';
import { ActorType, allowedTransitions } from './transition.matrix';
import { resolveSelectedTemplateVars } from './selected-template-vars';
import { APPLICATION_EVENTS, ApplicationStatusChangedPayload } from './events/application.events';

/** The caller identity + authorization context for a transition. */
export type TransitionActor =
  | { type: 'EMPLOYER'; userId: string; role: UserRole; companyId: string }
  | { type: 'ADMIN'; userId: string; role: UserRole };

export interface TransitionOpts {
  /** Employer-optional feedback, stored + carried in the REJECTED notification. */
  rejectionFeedback?: string;
  /** Mandatory on the admin path; stored on the timeline + audit, NEVER in candidate payloads. */
  overrideReason?: string;
  /**
   * SEAM (do NOT expose on any endpoint): force the SELECTED WhatsApp even when the
   * once-per-application guard (`selectedNotifiedAt`) is already set. Reserved for the
   * future manual "Send WhatsApp Update" admin action (Screen 26 / S6). No current
   * caller sets this — the WhatsApp otherwise fires exactly once, on the first entry.
   */
  bypassGuard?: boolean;
}

/** What the committed transaction hands to the post-commit dispatcher. */
interface CommittedTransition {
  updated: Application;
  fromStatus: ApplicationStatus;
  toStatus: ApplicationStatus;
  isAdminOverride: boolean;
  /** Decided INSIDE the lock (first-entry OR bypass) and carried out — never re-evaluated. */
  sendWhatsapp: boolean;
}

@Injectable()
export class StatusService {
  private readonly logger = new Logger(StatusService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobsService: JobsService,
    private readonly candidateRead: CandidateReadService,
    private readonly notificationService: NotificationService,
    private readonly auditService: AuditService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * The single transition code path for BOTH callers (employer + admin).
   *
   * Atomic core (one interactive transaction):
   *   FOR UPDATE lock → re-read status under the lock → matrix check → write
   *   (+ guard-set in the SAME update) → timeline row → logInTransaction audit.
   * On commit: emit the domain event + dispatch the per-status notification. If the
   * transaction rolls back (illegal move, override missing, audit failure), NOTHING
   * persists and NO notification is enqueued — the post-commit dispatch never runs.
   */
  async transition(
    applicationId: string,
    to: ApplicationStatus,
    actor: TransitionActor,
    opts: TransitionOpts = {},
  ): Promise<Application> {
    // Admin reason is mandatory — reject BEFORE opening the transaction (no write).
    if (actor.type === 'ADMIN') {
      if (!opts.overrideReason || opts.overrideReason.trim().length === 0) {
        throw new UnprocessableEntityException({ code: 'OVERRIDE_REASON_REQUIRED' });
      }
    }

    const committed = await this.prisma.$transaction(async (tx) => {
      // 1. Row-level lock — serializes concurrent PATCHes to this application.
      await tx.$queryRaw`SELECT id FROM applications WHERE id = ${applicationId} FOR UPDATE`;

      // 2. Re-read the TRUTH under the lock (the caller's view may be stale).
      const app = await tx.application.findUnique({ where: { id: applicationId } });
      if (!app) throw new NotFoundException({ code: 'APPLICATION_NOT_FOUND' });

      // Employer scoping: the application's job must belong to the caller's company.
      // Wrong owner → 404 (existence is not leaked). Read via JobsService (Rule 4).
      if (actor.type === 'EMPLOYER') {
        const job = await this.jobsService.getJobForApplication(app.jobId);
        if (job.companyId !== actor.companyId) {
          throw new NotFoundException({ code: 'APPLICATION_NOT_FOUND' });
        }
      }

      // Archived applications are frozen for both actors.
      if (app.archivedAt) {
        throw new UnprocessableEntityException({ code: 'APPLICATION_ARCHIVED' });
      }

      // 3. Matrix — consult the LOCKED status. Illegal (incl. same-state) → 422.
      const from = app.status;
      const actorType: ActorType = actor.type;
      const allowed = allowedTransitions(actorType, from);
      if (!allowed.includes(to)) {
        throw new UnprocessableEntityException({
          code: 'ILLEGAL_TRANSITION',
          meta: { from, to, allowed },
        });
      }

      // 4. Guard decision — made HERE, under the lock, and carried to post-commit.
      const firstSelectedEntry =
        to === ApplicationStatus.SELECTED && app.selectedNotifiedAt === null;

      // 5. Write status (+ set the guard in the SAME update on first SELECTED entry).
      const updated = await tx.application.update({
        where: { id: applicationId },
        data: {
          status: to,
          ...(to === ApplicationStatus.REJECTED &&
            opts.rejectionFeedback !== undefined && {
              rejectionFeedback: opts.rejectionFeedback,
            }),
          ...(firstSelectedEntry && { selectedNotifiedAt: new Date() }),
        },
      });

      // 6. Timeline row — overrideReason stored ONLY on the admin path.
      await tx.applicationTimelineEntry.create({
        data: {
          applicationId,
          fromStatus: from,
          toStatus: to,
          actorUserId: actor.userId,
          actorRole: actor.role,
          isAdminOverride: actor.type === 'ADMIN',
          overrideReason: actor.type === 'ADMIN' ? opts.overrideReason : null,
        },
      });

      // 7. Audit in the SAME tx — commits atomically with the write (or not at all).
      await this.auditService.logInTransaction(tx, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action:
          actor.type === 'ADMIN'
            ? AUDIT_ACTIONS.APPLICATION_ADMIN_OVERRIDE
            : AUDIT_ACTIONS.APPLICATION_STATUS_CHANGED,
        module: AUDIT_MODULES.APPLICATIONS,
        targetType: 'Application',
        targetId: applicationId,
        status: AuditStatus.SUCCESS,
        // overrideReason is admin-facing — fine in the audit trail.
        meta: {
          from,
          to,
          ...(actor.type === 'ADMIN' && { overrideReason: opts.overrideReason }),
        },
      });

      return {
        updated,
        fromStatus: from,
        toStatus: to,
        isAdminOverride: actor.type === 'ADMIN',
        sendWhatsapp: firstSelectedEntry || opts.bypassGuard === true,
      } satisfies CommittedTransition;
    });

    // 8. Post-commit, fire-safe: domain event + per-status notification dispatch.
    await this.dispatchPostCommit(committed);

    return committed.updated;
  }

  private async dispatchPostCommit(c: CommittedTransition): Promise<void> {
    const app = c.updated;

    const payload: ApplicationStatusChangedPayload = {
      applicationId: app.id,
      jobId: app.jobId,
      candidateId: app.candidateId,
      fromStatus: c.fromStatus,
      toStatus: c.toStatus,
      isAdminOverride: c.isAdminOverride,
    };
    this.eventEmitter.emit(APPLICATION_EVENTS.STATUS_CHANGED, payload);

    // Best-effort candidate notification — the transition is already committed;
    // a notification hiccup must not turn a committed move into a 500.
    try {
      if (!app.candidateId) return;
      const candidateUserId = await this.candidateRead.getUserIdForCandidate(app.candidateId);
      if (!candidateUserId) return;

      const notify = this.candidateNotification(c);
      if (!notify) return; // e.g. a move to PENDING has no candidate-facing notification

      // CR-WA W0: SELECTED is the one candidate transition that sends a WhatsApp
      // TEMPLATE, and a template needs its parameters. THIS module owns the
      // application and can reach the job/company through their public services;
      // the notification worker cannot (module-boundaries Rule 4), so the
      // parameters are resolved here and travel with the payload.
      if (notify.type === NotificationType.APPLICATION_SELECTED) {
        const vars = await resolveSelectedTemplateVars(
          { jobsService: this.jobsService, candidateRead: this.candidateRead, logger: this.logger },
          app.jobId,
          app.candidateId,
        );
        if (vars) notify.payload.data = { ...notify.payload.data, templateVars: vars };
      }

      await this.notificationService.notify(candidateUserId, notify.type, notify.payload, {
        // SELECTED re-entry (guard already set, no bypass) → email + in-app only.
        suppressWhatsapp: notify.type === NotificationType.APPLICATION_SELECTED && !c.sendWhatsapp,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`status-change notification failed for ${app.id}: ${msg}`);
    }
  }

  /**
   * The candidate-facing notification for a destination status, or null when the
   * destination has none (e.g. an admin move back to PENDING). overrideReason is
   * NEVER included in the candidate payload.
   */
  private candidateNotification(
    c: CommittedTransition,
  ): {
    type: NotificationType;
    payload: { title: string; body: string; data?: Record<string, unknown> };
  } | null {
    switch (c.toStatus) {
      case ApplicationStatus.SELECTED:
        return {
          type: NotificationType.APPLICATION_SELECTED,
          payload: {
            title: 'You have been selected',
            body: 'Congratulations — an employer has selected your application.',
            data: { applicationId: c.updated.id },
          },
        };
      case ApplicationStatus.SHORTLISTED:
        return {
          type: NotificationType.APPLICATION_SHORTLISTED,
          payload: {
            title: 'Application shortlisted',
            body: 'An employer has shortlisted your application.',
            data: { applicationId: c.updated.id },
          },
        };
      case ApplicationStatus.REJECTED:
        return {
          type: NotificationType.APPLICATION_REJECTED,
          payload: {
            title: 'Application update',
            body: 'An employer has updated your application status.',
            data: {
              applicationId: c.updated.id,
              ...(c.updated.rejectionFeedback ? { feedback: c.updated.rejectionFeedback } : {}),
            },
          },
        };
      default:
        return null;
    }
  }

  /**
   * Assert a user's employer company, for the employer PATCH controller. Kept here
   * so the controller stays thin; throws 403 if the user isn't linked to a company.
   */
  assertEmployer(role: UserRole): void {
    if (role !== UserRole.EMPLOYER) {
      throw new ForbiddenException({ code: 'NOT_EMPLOYER' });
    }
  }
}
