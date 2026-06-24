import { Injectable } from '@nestjs/common';
import { DocumentType } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import {
  MVP_MANDATORY_DOC_COUNT,
  MVP_MANDATORY_DOC_TYPES,
  SETTING_KEY_MANDATORY_DOC_COUNT,
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
  noticePeriod?: string | null;
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
  constructor(private readonly prisma: PrismaService) {}

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

    const mandatoryDocTypesPresent = profile.documents.map((d) => d.type as string);

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
      experiences: profile.experiences.map((e) => ({
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

    return result;
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
