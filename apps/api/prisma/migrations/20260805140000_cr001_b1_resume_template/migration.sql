-- CR-001 B1 — the resume template seam.
--
-- ADDITIVE ONLY, so this is safe to run BEFORE the new containers take traffic
-- (migrations.md / zero-downtime): code running the previous release neither
-- reads nor writes this column, and every existing row takes the default.
--
-- All four enum values are created now even though only CLASSIC has a renderer,
-- so B2 (MODERN / COMPACT / MINIMAL) ships without an enum migration. The API
-- gate is the DTO + the OpenAPI enum, which list only templates that exist.
--
-- DEFAULT 'CLASSIC' is deliberate: it is the template that has always rendered.
-- Defaulting to a new look would silently change the appearance of resumes
-- candidates have already sent to employers.

-- CreateEnum
CREATE TYPE "ResumeTemplate" AS ENUM ('CLASSIC', 'MODERN', 'COMPACT', 'MINIMAL');

-- AlterTable
ALTER TABLE "candidate_resumes" ADD COLUMN     "template" "ResumeTemplate" NOT NULL DEFAULT 'CLASSIC';
