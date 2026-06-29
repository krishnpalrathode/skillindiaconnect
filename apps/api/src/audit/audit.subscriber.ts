import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AuditStatus } from '@prisma/client';
import { CANDIDATE_EVENTS } from '../candidate/events/candidate.events';
import { AuditService } from './audit.service';
import { AUDIT_ACTIONS, AUDIT_MODULES } from './audit.types';

// Inline event payload shapes — avoid importing from other modules' service files.
// These must stay in sync with the emitting services.
interface SettingsChangedPayload {
  key: string;
}

interface CandidateChangedPayload {
  candidateId: string;
}

/**
 * Passive subscriber: turns existing domain events into audit rows.
 *
 * This is the "developers don't have to remember" layer — any module that emits
 * a domain event gets an audit row automatically without calling audit.log() directly.
 *
 * For security-critical audits that must commit atomically with a write (e.g. a
 * blocked job publish, an admin override), the feature module should call
 * AuditService.logInTransaction() directly rather than relying on this subscriber.
 *
 * Only events that EXIST in the codebase at the time this module was written are
 * wired. Future sprint events have stub comments naming the emitting sprint.
 */
@Injectable()
export class AuditSubscriber {
  constructor(private readonly auditService: AuditService) {}

  // ── Active subscribers ──────────────────────────────────────────────────────

  @OnEvent('settings.changed')
  async onSettingsChanged(payload: SettingsChangedPayload): Promise<void> {
    await this.auditService.log({
      action: AUDIT_ACTIONS.SETTINGS_UPDATE,
      module: AUDIT_MODULES.SETTINGS,
      targetType: 'Setting',
      targetId: payload.key,
      status: AuditStatus.SUCCESS,
      // meta.key = settings key string (e.g. 'worker_protection.accommodation_required')
      // Not a sensitive storage key — settings keys are human-readable policy names.
      meta: { key: payload.key },
    });
  }

  // Document r2Key is intentionally NOT included — storage keys are PII per the
  // redaction constitution. The event payload contains only candidateId.
  @OnEvent(CANDIDATE_EVENTS.DOCUMENT_CHANGED)
  async onDocumentChanged(payload: CandidateChangedPayload): Promise<void> {
    await this.auditService.log({
      action: AUDIT_ACTIONS.DOCUMENT_CHANGED,
      module: AUDIT_MODULES.CANDIDATE,
      targetType: 'CandidateDocument',
      targetId: payload.candidateId,
      status: AuditStatus.SUCCESS,
      meta: { candidateId: payload.candidateId },
    });
  }

  // ── Stubs for future sprint events ─────────────────────────────────────────
  // Uncomment + implement when the emitting module lands.
  // For BLOCKED/admin-override events use AuditService.logInTransaction() in the
  // feature module instead of the subscriber — those need atomic audit rows.

  // S1-3 AccountService.requestDeletion() does not yet emit an event;
  // add 'account.deletion.requested' emission there and uncomment this handler.
  // @OnEvent('account.deletion.requested')
  // async onAccountDeletionRequested(payload: { userId: string }): Promise<void> {
  //   await this.auditService.log({
  //     action: AUDIT_ACTIONS.ACCOUNT_DELETION_REQUESTED,
  //     module: AUDIT_MODULES.CANDIDATE,
  //     targetType: 'User',
  //     targetId: payload.userId,
  //     status: AuditStatus.SUCCESS,
  //     meta: { userId: payload.userId },
  //   });
  // }

  // S2-B4 EmployerService:
  // @OnEvent('employer.approved') → AUDIT_ACTIONS.EMPLOYER_APPROVED, AUDIT_MODULES.EMPLOYER
  // @OnEvent('employer.rejected') → AUDIT_ACTIONS.EMPLOYER_REJECTED
  // @OnEvent('employer.suspended') → AUDIT_ACTIONS.EMPLOYER_SUSPENDED

  // S2-B5 JobsService:
  // @OnEvent('job.published') → AUDIT_ACTIONS.JOB_PUBLISHED, AUDIT_MODULES.JOBS
  // 'job.publish.blocked' → logInTransaction(BLOCKED) in JobsService; no subscriber needed

  // S4 ApplicationsService:
  // @OnEvent('application.status.changed') → AUDIT_ACTIONS.APPLICATION_STATUS_CHANGED
  // 'application.admin_override' → logInTransaction(SUCCESS) in ApplicationsService

  // S5 PaymentsService:
  // @OnEvent('payment.captured') → AUDIT_ACTIONS.PAYMENT_CAPTURED, AUDIT_MODULES.PAYMENTS
  // @OnEvent('webhook.received') → AUDIT_ACTIONS.WEBHOOK_RECEIVED

  // S2-B3 NotificationsService (worker process):
  // @OnEvent('notification.delivered') → AUDIT_ACTIONS.NOTIFICATION_DELIVERED
  // @OnEvent('notification.failed') → AUDIT_ACTIONS.NOTIFICATION_FAILED, AuditStatus.FAILED
}
