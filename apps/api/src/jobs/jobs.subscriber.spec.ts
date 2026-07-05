/**
 * Unit tests for JobsSubscriber — the employer.suspended → pause-all-active-jobs cascade.
 *
 * All DB calls are mocked. Tests:
 * - Receiving employer.suspended event pauses all ACTIVE jobs for that company.
 * - Error in pauseAllActiveJobsForCompany is swallowed (subscriber must not crash worker).
 */
import { EMPLOYER_EVENTS } from '../employer/employer.events';
import { EmployerSuspendedPayload } from '../employer/employer.events';
import { JobsSubscriber } from './jobs.subscriber';
import { JobsService } from './jobs.service';

describe('JobsSubscriber', () => {
  let subscriber: JobsSubscriber;
  let pauseAllSpy: jest.SpyInstance;

  beforeEach(() => {
    const mockJobsService = {
      pauseAllActiveJobsForCompany: jest.fn().mockResolvedValue(undefined),
    } as unknown as JobsService;

    subscriber = new JobsSubscriber(mockJobsService);
    pauseAllSpy = jest.spyOn(mockJobsService, 'pauseAllActiveJobsForCompany');
  });

  it('calls pauseAllActiveJobsForCompany with the companyId from the event payload', async () => {
    const payload: EmployerSuspendedPayload = {
      companyId: 'co-suspended-1',
      companyName: 'Test Co',
      userId: 'user-1',
    };

    await subscriber.onEmployerSuspended(payload);

    expect(pauseAllSpy).toHaveBeenCalledWith('co-suspended-1', 'employer_suspended');
    expect(pauseAllSpy).toHaveBeenCalledTimes(1);
  });

  it('swallows errors so the subscriber never crashes the event emitter', async () => {
    pauseAllSpy.mockRejectedValueOnce(new Error('DB error'));

    const payload: EmployerSuspendedPayload = {
      companyId: 'co-error',
      companyName: 'Error Co',
      userId: 'user-2',
    };

    // Must resolve (not reject) even when service throws
    await expect(subscriber.onEmployerSuspended(payload)).resolves.toBeUndefined();
  });

  it('uses the correct event name (employer.suspended) matching B4 contract', () => {
    // This is a contract test: the decorator metadata must match what B4 emits.
    // We verify by checking the event name constant used in the @OnEvent decorator.
    expect(EMPLOYER_EVENTS.SUSPENDED).toBe('employer.suspended');
  });
});
