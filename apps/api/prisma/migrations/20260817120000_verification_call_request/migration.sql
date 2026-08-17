-- Employer-requested verification calls, plus the notification type that tells
-- admins one was booked.
--
-- Fully ADDITIVE and backward-compatible with the currently-running code: a new
-- table nothing older reads, and a new enum VALUE nothing older emits. That is
-- what lets `prisma migrate deploy` run BEFORE the new containers take traffic.
--
-- The enum value is added in its own statement with IF NOT EXISTS because
-- Postgres cannot add an enum value inside a transaction that also uses it, and
-- re-running the migration must not fail.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'VERIFICATION_CALL_REQUESTED';

-- One row per company: scheduling and re-scheduling are the same upsert, so the
-- unique constraint is the feature, not just an index.
CREATE TABLE "verification_call_requests" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "slotAt" TIMESTAMP(3) NOT NULL,
    "note" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_call_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "verification_call_requests_companyId_key"
    ON "verification_call_requests"("companyId");

-- Admins triage by "what is coming up next", so the slot is the access path.
CREATE INDEX "verification_call_requests_slotAt_idx"
    ON "verification_call_requests"("slotAt");

-- Scheduling state, not a financial record and not an audit trail — it goes
-- with the company.
ALTER TABLE "verification_call_requests"
    ADD CONSTRAINT "verification_call_requests_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
