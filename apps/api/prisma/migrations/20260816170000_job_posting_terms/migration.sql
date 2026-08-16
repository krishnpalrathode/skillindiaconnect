-- Per-job acceptance of the job-posting terms.
--
-- Two columns, not one boolean: the version string records WHAT was agreed to,
-- which is the question a dispute actually turns on. Nullable and unbackfilled
-- because jobs posted before the terms existed were never shown them, and
-- stamping a version onto them retroactively would fabricate an acceptance.
ALTER TABLE "jobs" ADD COLUMN "termsVersion" TEXT;
ALTER TABLE "jobs" ADD COLUMN "termsAcceptedAt" TIMESTAMP(3);
