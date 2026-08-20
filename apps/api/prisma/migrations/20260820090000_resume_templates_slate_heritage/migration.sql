-- Two more resume templates: SLATE (modern family) and HERITAGE (classic family).
--
-- Additive enum values only, IF NOT EXISTS so a re-run is harmless. Backward
-- compatible: currently-running code never emits these, and the template
-- registry falls back to CLASSIC for anything it does not recognise, so an old
-- container reading a row written by a new one still renders a valid resume.
ALTER TYPE "ResumeTemplate" ADD VALUE IF NOT EXISTS 'SLATE';
ALTER TYPE "ResumeTemplate" ADD VALUE IF NOT EXISTS 'HERITAGE';
