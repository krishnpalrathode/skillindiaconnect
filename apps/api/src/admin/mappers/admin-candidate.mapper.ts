import type {
  AdminCandidateDetailSource,
  AdminCandidateSource,
} from '../../candidate/candidate-read.service';

/**
 * Admin-context candidate serialization (Screen 25) — the contract's
 * AdminCandidateCard / AdminCandidateDetail.
 *
 * FULLER than the employer view: phone and email are shown regardless of the
 * candidate's showPhone toggle (admins are the DPDP data controllers), and the
 * deletion state (deletionDueAt / purgedAt) is included. STILL carries no
 * document keys or URLs — content is the separate, per-issuance-audited grant.
 *
 * A PURGED candidate needs no special-casing here: the anonymized row IS the
 * tombstone ("Deleted user", nulls, purgedAt set), and this mapper just
 * serializes what the purge left behind.
 */
export interface AdminCandidateCardDto {
  id: string;
  userId: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  status: string;
  profileVisible: boolean;
  completionPct: number;
  documents: { type: string; uploaded: boolean; expiryDate: string | null }[];
  deletionDueAt: string | null;
  purgedAt: string | null;
  createdAt: string;
}

export interface AdminCandidateDetailDto extends AdminCandidateCardDto {
  experiences: {
    id: string;
    type: string;
    country: string;
    companyName: string;
    role: string;
    years: number;
    months: number;
    startDate: string | null;
    endDate: string | null;
  }[];
  skills: { id: string; name: string }[];
  applicationCount: number;
}

export function toAdminCandidateCard(source: AdminCandidateSource): AdminCandidateCardDto {
  return {
    id: source.id,
    userId: source.userId,
    fullName: source.fullName,
    phone: source.phone,
    email: source.user.email,
    status: source.user.status,
    profileVisible: source.profileVisible,
    completionPct: source.completionPct,
    documents: source.documents.map((d) => ({
      type: d.type,
      uploaded: true,
      expiryDate: d.expiryDate ? d.expiryDate.toISOString() : null,
    })),
    deletionDueAt: source.user.deletionDueAt ? source.user.deletionDueAt.toISOString() : null,
    purgedAt: source.user.purgedAt ? source.user.purgedAt.toISOString() : null,
    createdAt: source.createdAt.toISOString(),
  };
}

export function toAdminCandidateDetail(
  source: AdminCandidateDetailSource,
  applicationCount: number,
): AdminCandidateDetailDto {
  return {
    ...toAdminCandidateCard(source),
    experiences: source.experiences.map((e) => ({
      id: e.id,
      type: e.type,
      country: e.country,
      companyName: e.companyName,
      role: e.role,
      years: e.years,
      months: e.months,
      startDate: e.startDate ? e.startDate.toISOString() : null,
      endDate: e.endDate ? e.endDate.toISOString() : null,
    })),
    skills: source.skills,
    applicationCount,
  };
}
