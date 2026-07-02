import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EMPLOYER_EVENTS, EmployerSuspendedPayload } from '../employer/employer.events';
import { JobsService } from './jobs.service';

/**
 * Subscribes to employer lifecycle events and cascades changes to jobs.
 *
 * employer.suspended → pause all ACTIVE jobs for the company (audited).
 *
 * Reactivation (employer.reactivated) does NOT auto-resume jobs — the employer
 * must manually resume each job via POST /employers/me/jobs/:id/resume. This is
 * intentional: an employer may want to review their listings before re-activating.
 */
@Injectable()
export class JobsSubscriber {
  private readonly logger = new Logger(JobsSubscriber.name);

  constructor(private readonly jobsService: JobsService) {}

  @OnEvent(EMPLOYER_EVENTS.SUSPENDED)
  async onEmployerSuspended(payload: EmployerSuspendedPayload): Promise<void> {
    try {
      await this.jobsService.pauseAllActiveJobsForCompany(
        payload.companyId,
        'employer_suspended',
      );
    } catch (err: unknown) {
      // Never let the subscriber throw — it would crash the event emitter's error path.
      this.logger.error(
        `Failed to pause jobs for suspended company ${payload.companyId}`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}
