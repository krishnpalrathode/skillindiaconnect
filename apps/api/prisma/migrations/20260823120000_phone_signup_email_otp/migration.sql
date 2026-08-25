-- Phone signup: email becomes optional, and OTPs can target an email.
--
-- EXPAND ONLY. Every statement here is backward-compatible with the currently
-- running code (migrations deploy BEFORE new containers take traffic):
--   * dropping NOT NULL on users.email cannot break a reader
--   * the new columns are nullable and unread by the old code
-- Nothing is backfilled and nothing is dropped.

-- users.email: NOT NULL -> NULL.
-- A candidate who signs up by phone has no address until onboarding collects
-- one. The UNIQUE index is unaffected: Postgres permits many NULLs under it, so
-- every address that IS set stays unique.
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;

-- When the address was proven by an EMAIL_VERIFY OTP. NULL for every account
-- that predates this, which means "unverified", not "invalid".
ALTER TABLE "users" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);

-- OTPs can now be addressed to an email instead of a phone.
ALTER TYPE "OtpPurpose" ADD VALUE 'EMAIL_VERIFY';

ALTER TABLE "otp_challenges" ALTER COLUMN "phone" DROP NOT NULL;
ALTER TABLE "otp_challenges" ADD COLUMN "email" CITEXT;

CREATE INDEX "otp_challenges_email_purpose_createdAt_idx"
  ON "otp_challenges" ("email", "purpose", "createdAt");
