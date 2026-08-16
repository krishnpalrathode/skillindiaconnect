import { ConflictException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { DocumentType } from '@prisma/client';
import { PrismaService } from '../core/prisma/prisma.service';
import { CandidateApplyInputs } from '../candidate/candidate-read.service';
import { assessPassportValidity, PASSPORT_MIN_VALIDITY_DAYS } from '../candidate/passport-validity';
import { JobForApplication } from '../jobs/jobs.service';

export interface ApplyGateSettings {
  /** From Settings `MIN_COMPLETION_PCT` — the SAME source the completion ring reads. */
  minCompletionPct: number;
  /** From Settings `MANDATORY_DOCUMENTS`. */
  mandatoryDocs: DocumentType[];
}

export interface ApplyGatePass {
  docsPresentCount: number;
  docsRequiredCount: number;
}

/**
 * The five-gate apply enforcement — LOCKED ORDER, fail-fast, distinct codes.
 *
 * This is where the completion engine's long-reported pct is finally ENFORCED.
 * The order is contractual: a request that fails multiple gates gets the FIRST
 * gate's code, never a later one. Each gate throws immediately.
 *
 *   1. JOB_NOT_ACTIVE       (422) — job.status !== ACTIVE
 *   2. ALREADY_APPLIED      (409) — an application already exists for (job, candidate)
 *   3. PROFILE_INCOMPLETE   (422) — stored completionPct < minCompletionPct
 *   4. MANDATORY_DOCS_MISSING (422) — a required document type is absent
 *   5. PASSPORT_INVALID     (422) — passport absent, or present-but-expired
 *
 * The threshold and mandatory-doc list come from Settings (the single source the
 * completion engine also reads) — zero drift between gate and ring.
 */
@Injectable()
export class ApplyGateService {
  constructor(private readonly prisma: PrismaService) {}

  async assertCanApply(
    candidate: CandidateApplyInputs,
    job: JobForApplication,
    settings: ApplyGateSettings,
  ): Promise<ApplyGatePass> {
    // ── Gate 1: job active ──────────────────────────────────────────────────
    if (job.status !== 'ACTIVE') {
      throw new UnprocessableEntityException({ code: 'JOB_NOT_ACTIVE' });
    }

    // ── Gate 2: not already applied (pre-check; the DB unique is the guarantee)
    const existing = await this.prisma.application.findUnique({
      where: { jobId_candidateId: { jobId: job.id, candidateId: candidate.candidateId } },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException({ code: 'ALREADY_APPLIED' });
    }

    // ── Gate 3: profile completion (STORED pct — never recomputed here) ──────
    if (candidate.completionPct < settings.minCompletionPct) {
      // Contract meta keys are `completionPct` / `threshold` (openapi.yaml apply
      // gate ladder) — the web ApplyErrorState reads exactly these. Do NOT rename.
      throw new UnprocessableEntityException({
        code: 'PROFILE_INCOMPLETE',
        meta: { completionPct: candidate.completionPct, threshold: settings.minCompletionPct },
      });
    }

    // ── Gate 4: mandatory documents present ─────────────────────────────────
    const presentTypes = new Set(candidate.documents.map((d) => d.type));
    const missing = settings.mandatoryDocs.filter((t) => !presentTypes.has(t));
    if (missing.length > 0) {
      throw new UnprocessableEntityException({
        code: 'MANDATORY_DOCS_MISSING',
        meta: { missing },
      });
    }

    // ── Gate 5: passport valid (absent, or uploaded-but-expired) ────────────
    // A missing passport also trips gate 4 when PASSPORT is mandatory — gate 4
    // fires first by order. Gate 5 exists to catch the uploaded-but-expired case
    // (and the missing case when PASSPORT is NOT in the mandatory list).
    const passport = candidate.documents.find((d) => d.type === DocumentType.PASSPORT);
    if (!passport) {
      throw new UnprocessableEntityException({
        code: 'PASSPORT_INVALID',
        meta: { reason: 'missing' },
      });
    }
    /*
      Re-checked here and not merely at upload, because validity DECAYS. A
      passport uploaded with seven months left drops under the six-month floor
      six weeks later with nobody touching anything, and the apply gate is the
      last point before an employer commits to a candidate whose visa will be
      refused. `reason` distinguishes the two so the UI can say "renew your
      passport" rather than "your passport has expired" to someone holding a
      passport that is still perfectly valid for travel.
    */
    const validity = assessPassportValidity(passport.expiryDate);
    if (validity.blocks) {
      throw new UnprocessableEntityException({
        code: 'PASSPORT_INVALID',
        meta: {
          reason: validity.status === 'below_minimum' ? 'below_minimum' : 'expired',
          minValidityDays: PASSPORT_MIN_VALIDITY_DAYS,
          daysRemaining: validity.daysRemaining,
        },
      });
    }

    return {
      docsPresentCount: settings.mandatoryDocs.length - missing.length,
      docsRequiredCount: settings.mandatoryDocs.length,
    };
  }
}
