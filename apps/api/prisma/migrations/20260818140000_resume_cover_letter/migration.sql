-- Cover letter, rendered alongside the resume in the same worker job.
--
-- Two nullable columns on the existing generation row: purely additive, so
-- currently-running code neither writes nor reads them and `migrate deploy` is
-- safe before new containers take traffic. Existing rows keep NULL, which the
-- download endpoint reads as "regenerate to get one" rather than as an error.
ALTER TABLE "resume_generations" ADD COLUMN "coverLetterR2Key" TEXT;
ALTER TABLE "resume_generations" ADD COLUMN "coverLetterSizeBytes" INTEGER;
