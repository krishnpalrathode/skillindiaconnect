-- Company profile gains an explicit country and a separate phone dial code.
--
-- EXPAND-only and backward compatible: both columns are nullable, so existing
-- rows (registered before these fields existed) stay valid and code that does
-- not yet write them keeps working. The register DTO requires both for every
-- NEW company; a later CONTRACT release can tighten these to NOT NULL once
-- every row has been backfilled.
--
-- AlterTable
ALTER TABLE "companies" ADD COLUMN "phoneCode" TEXT;
ALTER TABLE "companies" ADD COLUMN "country" TEXT;
