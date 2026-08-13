-- Three additional resume templates: ELEGANT (decorative serif), EXECUTIVE
-- (full-bleed colour band) and TIMELINE (vertical work-history rail).
--
-- Purely ADDITIVE — new enum labels only. No existing row changes value and no
-- column is rewritten, so this is backward-compatible with the currently running
-- code: an old API process simply never writes the new labels, and it never
-- reads one either because only a newer client can select them. That is what
-- lets `prisma migrate deploy` run before the new containers take traffic.
--
-- Postgres cannot add enum labels inside a transaction block in older versions;
-- `ADD VALUE IF NOT EXISTS` is used so a partially-applied run is safe to retry.
ALTER TYPE "ResumeTemplate" ADD VALUE IF NOT EXISTS 'ELEGANT';
ALTER TYPE "ResumeTemplate" ADD VALUE IF NOT EXISTS 'EXECUTIVE';
ALTER TYPE "ResumeTemplate" ADD VALUE IF NOT EXISTS 'TIMELINE';
