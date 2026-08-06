import { Logger } from '@nestjs/common';
import { JobsService } from '../jobs/jobs.service';
import { CandidateReadService } from '../candidate/candidate-read.service';

/**
 * THE ordered parameters for the approved `job_selected` WhatsApp template
 * (CR-WA W0):
 *
 *   {{1}} candidate name   {{2}} job title   {{3}} company
 *
 * ⚠️ THE ORDER IS THE CONTRACT. Meta's template parameters are POSITIONAL, so a
 * swapped pair produces a message that reads perfectly and says something false
 * — "selected for Gulf Wiring LLC at Senior Electrician". It cannot be unsent.
 *
 * This lives in ONE place because there are TWO senders — the employer
 * transition (status.service) and the admin resend (admin-resend.service). Two
 * copies of a positional contract is how they drift, and the drift is invisible
 * until a candidate reads the message.
 *
 * WHY HERE AND NOT IN THE NOTIFICATION WORKER: a job title and a company name
 * belong to the jobs and employer modules. The notification module resolving
 * them would mean querying tables it does not own (module-boundaries Rule 4).
 * The module raising the notification already holds the ids, so it resolves
 * them through those modules' PUBLIC services and passes the result along.
 *
 * Returns null when anything is unresolvable. The caller then omits the
 * parameters entirely, and the worker fails the WhatsApp honestly and falls
 * back to email — which is far better than sending "You have been selected
 * for  at ".
 */
export async function resolveSelectedTemplateVars(
  deps: { jobsService: JobsService; candidateRead: CandidateReadService; logger: Logger },
  jobId: string,
  candidateId: string | null,
): Promise<string[] | null> {
  if (!candidateId) return null;
  try {
    const [jobs, names] = await Promise.all([
      deps.jobsService.getJobSubsets([jobId]),
      deps.candidateRead.getNamesByIds([candidateId]),
    ]);
    const job = jobs.get(jobId);
    const name = names.get(candidateId);
    if (!job?.title || !job.companyName || !name) return null;
    return [name, job.title, job.companyName];
  } catch (err) {
    // Never let parameter lookup turn a committed transition into a 500 — both
    // callers dispatch post-commit and are already best-effort for that reason.
    deps.logger.error(
      `selected template vars unresolved for job ${jobId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }
}
