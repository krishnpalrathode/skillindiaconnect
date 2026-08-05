-- Registration number is no longer mandatory at employer sign-up.
--
-- EXPAND-only and backward compatible: dropping NOT NULL never fails on
-- existing rows and never loses data, so this deploys safely BEFORE the new
-- code takes traffic. Code that still always sends the column keeps working.
--
-- AlterTable
ALTER TABLE "companies" ALTER COLUMN "registrationNumber" DROP NOT NULL;
