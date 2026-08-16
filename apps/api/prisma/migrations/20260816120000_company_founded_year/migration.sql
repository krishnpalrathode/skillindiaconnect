-- Company foundation year.
--
-- Added NULLABLE and with no backfill. Companies registered before this field
-- existed genuinely have no answer, and defaulting them to any year would write
-- a fabricated fact onto the profile admins read when approving an employer.
-- The register DTO requires the value for every NEW company, so the nulls are a
-- closed set that only shrinks as old employers edit their profile.
ALTER TABLE "companies" ADD COLUMN "foundedYear" INTEGER;
