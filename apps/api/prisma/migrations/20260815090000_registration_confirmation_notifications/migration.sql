-- Two notification types for the "you're set up" confirmations:
--   CANDIDATE_PROFILE_COMPLETE — first time a candidate crosses the apply
--     threshold, so the person who just spent twenty minutes on a phone gets
--     told it worked.
--   EMPLOYER_REGISTERED — company registration received and under review.
--     Distinct from EMPLOYER_APPROVED, which is the later "you are live" mail.
--
-- Purely ADDITIVE — new enum labels only. No existing row changes value and no
-- column is rewritten, so this is backward-compatible with the currently running
-- code: an old API process never writes these labels and never reads one,
-- because only a newer process raises them. That is what lets
-- `prisma migrate deploy` run BEFORE the new containers take traffic.
--
-- Postgres cannot add enum labels inside a transaction block in older versions;
-- `ADD VALUE IF NOT EXISTS` is used so a partially-applied run is safe to retry.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CANDIDATE_PROFILE_COMPLETE';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'EMPLOYER_REGISTERED';
