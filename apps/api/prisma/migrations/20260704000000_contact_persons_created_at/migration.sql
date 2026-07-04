-- Expand-only: adds createdAt to contact_persons with a stable default.
-- Required by the S3-0 frozen spec (ContactPerson.createdAt is a required field).
-- Backward-compatible with any currently-running code — no data loss, no lock escalation.
ALTER TABLE "contact_persons" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW();
