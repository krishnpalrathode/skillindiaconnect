import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DocumentType, NotificationType, WorkExperience } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { QUEUE_NAMES, JOB_NAMES } from '../../queue/queue.constants';
import { NotificationService } from '../../notifications/notification.service';
import {
  DEFAULT_MATCH_ALERT_MIN_PCT,
  MVP_MANDATORY_DOC_COUNT,
  MVP_MANDATORY_DOC_TYPES,
  SETTING_KEY_MANDATORY_DOC_COUNT,
  SETTING_KEY_MATCH_ALERT_MIN_PCT,
  SETTING_KEY_MIN_COMPLETION_PCT,
  DEFAULT_MIN_COMPLETION_FOR_APPLY,
  WEIGHTS,
} from './completion.constants';

// ─── Input / output types ──────────────────────────────────────────────────────

export interface CompletionProfileInput {
  photoKey: string | null;
  fullName: string;
  fatherName: string | null;
  dob: Date | null;
  phoneVerifiedAt: Date | null;
  maritalStatus: string | null;
  languages: string[];
  jobCategoryId: string | null;
  currentLocation: string | null;
  nationality: string | null;
  // Present on the profile but UNSCORED (DPDP / CR-001 B1) — included so tests
  // can assert they do not affect pct.
  religion?: string | null;
  noticePeriod?: number | null;
}

export interface CompletionWorkExpInput {
  type: string;
  country: string;
  companyName: string;
  role: string;
  years: number;
}

export interface CompletionInput {
  profile: CompletionProfileInput;
  experiences: CompletionWorkExpInput[];
  skillCount: number;
  mandatoryDocTypesPresent: string[];
  mandatoryDocCount: number;
}

export interface CompletionSection {
  key: string;
  label: string;
  pct: number;
  complete: boolean;
}

export interface CompletionResult {
  /** Rounded integer — matches the stored completionPct column. */
  pct: number;
  sections: CompletionSection[];
}

// ─── Pure scoring function ────────────────────────────────────────────────────
// No DB calls, no side effects — the entire scoring contract in one place.

export function compute(input: CompletionInput): CompletionResult {
  const p = input.profile;

  // Personal info: 10 fields × 4% each. Religion + noticePeriod are NOT scored.
  const perField = WEIGHTS.personalInfoPerField;
  let piScore = 0;
  if (p.photoKey) piScore += perField;
  if (p.fullName) piScore += perField;
  if (p.fatherName) piScore += perField;
  if (p.dob) piScore += perField;
  if (p.phoneVerifiedAt) piScore += perField;
  if (p.maritalStatus) piScore += perField;
  if (p.languages.length >= 1) piScore += perField;
  if (p.jobCategoryId) piScore += perField;
  if (p.currentLocation) piScore += perField;
  if (p.nationality) piScore += perField;

  // Experience: ≥1 "complete" entry (all 4 string fields present) = 20%.
  const hasCompleteExp = input.experiences.some(
    (e) => e.type && e.country && e.companyName && e.role,
  );
  const expScore = hasCompleteExp ? WEIGHTS.experience : 0;

  // Documents: 30 / N per mandatory type present, N from settings.
  const docPerItem = input.mandatoryDocCount > 0 ? WEIGHTS.documents / input.mandatoryDocCount : 0;
  const docScore = Math.min(input.mandatoryDocTypesPresent.length * docPerItem, WEIGHTS.documents);

  // Skills: 10/3 per skill, capped at 3 skills.
  const skillPerItem = WEIGHTS.skills / WEIGHTS.skillCap;
  const skillScore = Math.min(input.skillCount, WEIGHTS.skillCap) * skillPerItem;

  const pct = Math.min(Math.round(piScore + expScore + docScore + skillScore), 100);

  return {
    pct,
    sections: [
      {
        key: 'personalInfo',
        label: 'Personal Information',
        pct: piScore,
        complete: piScore >= WEIGHTS.personalInfoTotal,
      },
      {
        key: 'experience',
        label: 'Work Experience',
        pct: expScore,
        complete: expScore >= WEIGHTS.experience,
      },
      {
        key: 'documents',
        label: 'Documents',
        pct: docScore,
        complete: docScore >= WEIGHTS.documents,
      },
      {
        key: 'skills',
        label: 'Skills',
        pct: skillScore,
        complete: skillScore >= WEIGHTS.skills,
      },
    ],
  };
}

// ─── Service wrapper (DB access lives here) ───────────────────────────────────

@Injectable()
export class CompletionService {
  private readonly logger = new Logger(CompletionService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_NAMES.MATCH_ALERT) private readonly matchAlertQueue: Queue,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * Load a candidate's profile + relations from DB, run compute(), persist
   * the new completionPct, and return the full CompletionResult.
   */
  async recomputeForCandidate(candidateId: string): Promise<CompletionResult> {
    const mandatoryDocCount = await this.getMandatoryDocCount();

    const profile = await this.prisma.candidateProfile.findUniqueOrThrow({
      where: { id: candidateId },
      include: {
        experiences: true,
        skills: true,
        documents: {
          where: { type: { in: MVP_MANDATORY_DOC_TYPES as unknown as DocumentType[] } },
          select: { type: true },
        },
      },
    });

    const mandatoryDocTypesPresent = profile.documents.map(
      (d: { type: DocumentType }) => d.type as string,
    );

    const result = compute({
      profile: {
        photoKey: profile.photoKey,
        fullName: profile.fullName,
        fatherName: profile.fatherName,
        dob: profile.dob,
        phoneVerifiedAt: profile.phoneVerifiedAt,
        maritalStatus: profile.maritalStatus,
        languages: profile.languages,
        jobCategoryId: profile.jobCategoryId,
        currentLocation: profile.currentLocation,
        nationality: profile.nationality,
      },
      experiences: profile.experiences.map((e: WorkExperience) => ({
        type: e.type as string,
        country: e.country,
        companyName: e.companyName,
        role: e.role,
        years: e.years,
      })),
      skillCount: profile.skills.length,
      mandatoryDocTypesPresent,
      mandatoryDocCount,
    });

    await this.prisma.candidateProfile.update({
      where: { id: candidateId },
      data: { completionPct: result.pct },
    });

    await this.maybeEnqueueMatchAlert(candidateId, result.pct, profile.matchAlertSentAt);
    await this.maybeNotifyProfileComplete(profile.userId, result.pct);

    return result;
  }

  /**
   * Confirm, once, that the profile is now good enough to apply with.
   *
   * ── Why the APPLY threshold and not 100% ────────────────────────────────────
   * 100% is a score, not a capability. A candidate sitting at 96% can already
   * apply to every job on the platform, and telling them nothing until they
   * fill an optional field would withhold the one message that says their work
   * paid off. Crossing the apply threshold is the moment something real
   * changes, so that is the moment worth an email — and it is why the copy says
   * "you can now apply" rather than "profile complete".
   *
   * ── Fire-once, without a new column ─────────────────────────────────────────
   * Deduped by asking whether this notification already exists for the user,
   * the same approach `passport-expiry.processor` uses for its per-window gate.
   * A dedicated `profileCompleteNotifiedAt` column would have been the obvious
   * design and would have cost a schema change plus a backfill; the feed row is
   * already the durable record of "we told them".
   *
   * Failures are logged and swallowed for the same reason the match alert's are:
   * a notification outage must not turn a successful profile save into a 500.
   */
  private async maybeNotifyProfileComplete(userId: string, pct: number): Promise<void> {
    try {
      const threshold = await this.getMinCompletionPct();
      if (pct < threshold) return;

      const alreadySent = await this.prisma.notification.count({
        where: { userId, type: NotificationType.CANDIDATE_PROFILE_COMPLETE },
      });
      if (alreadySent > 0) return;

      await this.notifications.notify(userId, NotificationType.CANDIDATE_PROFILE_COMPLETE, {
        title: 'Your profile is ready',
        body: `Your profile is ${pct}% complete — enough to start applying for jobs.`,
        data: { completionPct: pct },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`profile-complete notify failed for user ${userId}: ${msg}`);
    }
  }

  /** Apply threshold from Settings, falling back to the default when unset. */
  async getMinCompletionPct(): Promise<number> {
    const setting = await this.prisma.setting.findUnique({
      where: { key: SETTING_KEY_MIN_COMPLETION_PCT },
    });
    const val = setting?.value;
    return typeof val === 'number' && Number.isFinite(val) ? val : DEFAULT_MIN_COMPLETION_FOR_APPLY;
  }

  /**
   * Enqueue the job-match alert when this recompute took the profile to (or
   * past) the threshold for the first time.
   *
   * The API process does NOTHING here but write state and enqueue — the
   * matching query and the WhatsApp/email sends belong to the WORKER
   * (worker-and-external-sends.md). `matchAlertSentAt` read above is the
   * fire-once guard; the worker re-checks it under its own read before sending,
   * so two concurrent recomputes cannot both alert.
   *
   * The jobId is deterministic per candidate for the same reason cron jobs are
   * (cron-queue-dedupe.md): profile edits fire recompute repeatedly, and every
   * one of them would otherwise enqueue another copy.
   *
   * Failures here are logged and swallowed. A queue outage must not turn a
   * successful profile save into a 500 — the alert is a nicety, the save is not.
   */
  private async maybeEnqueueMatchAlert(
    candidateId: string,
    pct: number,
    matchAlertSentAt: Date | null,
  ): Promise<void> {
    if (matchAlertSentAt !== null) return;

    const threshold = await this.getMatchAlertMinPct();
    if (pct < threshold) return;

    try {
      await this.matchAlertQueue.add(
        JOB_NAMES.SEND_MATCH_ALERT,
        { candidateId },
        // Hyphen, NOT colon: BullMQ 5 rejects ':' in a custom jobId
        // ("Custom Id cannot contain :"). Matches `purge-${userId}` elsewhere.
        { jobId: `match-alert-${candidateId}` },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`match-alert enqueue failed for candidate ${candidateId}: ${msg}`);
    }
  }

  /** Threshold from Settings, falling back to the default when unset. */
  async getMatchAlertMinPct(): Promise<number> {
    const setting = await this.prisma.setting.findUnique({
      where: { key: SETTING_KEY_MATCH_ALERT_MIN_PCT },
    });
    const val = setting?.value;
    return typeof val === 'number' && Number.isFinite(val) ? val : DEFAULT_MATCH_ALERT_MIN_PCT;
  }

  async getMandatoryDocCount(): Promise<number> {
    const setting = await this.prisma.setting.findUnique({
      where: { key: SETTING_KEY_MANDATORY_DOC_COUNT },
    });
    if (!setting) return MVP_MANDATORY_DOC_COUNT;
    const val = setting.value;
    // The seed stores this key as a JSON array of doc-type strings; derive N from length.
    if (Array.isArray(val) && val.length > 0) return val.length;
    if (typeof val === 'number' && val > 0) return val;
    return MVP_MANDATORY_DOC_COUNT;
  }
}
