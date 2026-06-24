-- AlterEnum
-- Adding LOGIN purpose so the same otp_challenges table serves phone-login flows.
-- ALTER TYPE ... ADD VALUE is expand-safe (additive) and applies without backfill.
-- Must NOT be combined with a statement that uses the new value in the same migration
-- because Postgres cannot see a newly-added enum value within the same transaction.
ALTER TYPE "OtpPurpose" ADD VALUE 'LOGIN';
