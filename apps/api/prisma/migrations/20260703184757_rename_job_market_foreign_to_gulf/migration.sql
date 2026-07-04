-- Renames the JobMarket enum value FOREIGN -> GULF to match the published
-- API contract (packages/contract/openapi.yaml declares `enum: [GULF, LOCAL]`).
-- ALTER TYPE ... RENAME VALUE updates all existing rows in place (safe,
-- non-destructive) instead of Prisma's default drop-and-recreate approach.
ALTER TYPE "JobMarket" RENAME VALUE 'FOREIGN' TO 'GULF';
