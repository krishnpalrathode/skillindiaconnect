import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Company, Job, JobStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../core/prisma/prisma.service';
import { EmployerService } from '../employer/employer.service';
import { SettingsService } from '../settings/settings.service';
import { SETTING_KEYS } from '../settings/settings.keys';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS, AUDIT_MODULES, AuditStatus } from '../audit/audit.types';
import { SubscriptionReadService } from '../payments/subscription-read.service';
import { JOB_EVENTS, JobPublishBlockedPayload } from './jobs.events';

/**
 * The platform's publish enforcement gate.
 *
 * Runs in LOCKED order, fail-fast:
 *   1. Approved employer  (403 EMPLOYER_NOT_APPROVED)
 *   2. Worker-protection rules read from Settings  (422 WORKER_PROTECTION_VIOLATION + BLOCKED audit)
 *   3. Quota  (422 JOB_QUOTA_EXCEEDED)
 *
 * A not-approved employer never reaches checks 2 or 3 — order is enforced, not merely documented.
 * Protection rules are read from SettingsService at every call; cache-DEL on write guarantees
 * freshness. Never cache rules inside this module.
 *
 * S5-B3 closed the S5 TODO: the quota's plan lookup goes through
 * SubscriptionReadService.effectivePlan() — the single plan-truth source shared
 * with the Pro document gate. This module no longer reads the subscriptions table.
 */
@Injectable()
export class PublishGuardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employerService: EmployerService,
    private readonly settingsService: SettingsService,
    private readonly auditService: AuditService,
    private readonly subscriptionReadService: SubscriptionReadService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async assertPublishable(
    job: Pick<
      Job,
      'id' | 'companyId' | 'accommodation' | 'healthInsurance' | 'transportation'
    >,
    company: Pick<Company, 'id'>,
    actorUserId: string,
    actorRole: UserRole,
  ): Promise<void> {
    // ── 1. Approved employer ──────────────────────────────────────────────────
    // Throws 403 EMPLOYER_NOT_APPROVED if company is not APPROVED.
    await this.employerService.assertApproved(company.id);

    // ── 2. Worker-protection rules (read from Settings — never hardcoded) ─────
    // Cache DEL on Settings write guarantees the next read sees the updated value
    // immediately. Do NOT cache these results inside this module.
    const [accommodationRequired, healthInsuranceRequired, transportationRequired] =
      await Promise.all([
        this.settingsService.get(SETTING_KEYS.ACCOMMODATION_REQUIRED),
        this.settingsService.get(SETTING_KEYS.HEALTH_INSURANCE_REQUIRED),
        this.settingsService.get(SETTING_KEYS.TRANSPORTATION_REQUIRED),
      ]);

    const failedRules: string[] = [];
    if (accommodationRequired && !job.accommodation) failedRules.push('accommodation');
    if (healthInsuranceRequired && !job.healthInsurance) failedRules.push('healthInsurance');
    if (transportationRequired && !job.transportation) failedRules.push('transportation');

    if (failedRules.length > 0) {
      // Write the BLOCKED audit row (Screen-29's "job creation blocked" event).
      // Fire-and-safe: a blocked publish has no successful DB write to be atomic with.
      await this.auditService.log({
        actorUserId,
        actorRole,
        action: AUDIT_ACTIONS.JOB_PUBLISH_BLOCKED,
        module: AUDIT_MODULES.JOBS,
        targetType: 'Job',
        targetId: job.id,
        status: AuditStatus.BLOCKED,
        meta: { failedRules, companyId: company.id },
      });

      const payload: JobPublishBlockedPayload = {
        jobId: job.id,
        companyId: company.id,
        failedRules,
      };
      this.eventEmitter.emit(JOB_EVENTS.PUBLISH_BLOCKED, payload);

      throw new UnprocessableEntityException({
        code: 'WORKER_PROTECTION_VIOLATION',
        meta: { violations: failedRules },
      });
    }

    // ── 3. Quota check ────────────────────────────────────────────────────────
    // effectivePlan() owns ALL subscription-state interpretation (S5-B3):
    // ACTIVE/GRACE paid plan → its maxActiveJobs (null = unlimited); EXPIRED or
    // none → the FREE cap from Settings. GRACE still means they paid.
    const { maxActiveJobs } = await this.subscriptionReadService.effectivePlan(company.id);

    if (maxActiveJobs !== null) {
      const activeCount = await this.prisma.job.count({
        where: { companyId: company.id, status: JobStatus.ACTIVE },
      });
      if (activeCount >= maxActiveJobs) {
        throw new UnprocessableEntityException({
          code: 'JOB_QUOTA_EXCEEDED',
          meta: { planLimit: maxActiveJobs },
        });
      }
    }
  }
}
