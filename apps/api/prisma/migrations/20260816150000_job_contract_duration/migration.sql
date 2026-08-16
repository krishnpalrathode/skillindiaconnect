-- Contract duration as a BAND, for CONTRACT roles.
--
-- Added NULLABLE with no backfill: the column is meaningless for full-time and
-- part-time jobs, and existing contract jobs never collected a duration, so any
-- default would invent a term the employer never agreed to. The "required
-- exactly when employmentType = CONTRACT" pairing is enforced in the service,
-- which can see both columns; a CHECK constraint here would also block the
-- perfectly ordinary act of switching an existing job away from CONTRACT.
CREATE TYPE "ContractDuration" AS ENUM ('MONTHS_1_6', 'MONTHS_6_12', 'YEARS_1_2', 'YEARS_2_5');

ALTER TABLE "jobs" ADD COLUMN "contractDuration" "ContractDuration";
