# Migrations

- **Prisma migrate is the ONLY schema-mutation path.** No manual DDL in any
  environment, especially production.
- **Raw-SQL migrations are reviewed line-by-line.** Anything Prisma can't express
  (generated columns, sequences, GIN/BRIN indexes, triggers) is hand-edited into
  the migration SQL and MUST get a second reviewer + the `migration-reviewed`
  label (CI gate). Never `migrate dev --create-only` and then skip review.
- **Breaking changes use expand → backfill → contract across TWO releases:**
  release A adds the nullable column + backfills via script; release B (after all
  old code is gone) tightens the constraint. Never run destructive DDL in the same
  release as the code that stops writing the old shape. This is what makes
  `prisma migrate deploy` run safely BEFORE new containers take traffic
  (zero-downtime): every single migration is backward-compatible with the
  currently-running code.
- **After any migration, verify `prisma migrate diff` reports no drift.** Watch
  two spots: `@default(dbgenerated(...))` defaults (Postgres normalizes the
  expression — match the normalized form), and `Unsupported(...)` columns.
- Canonical example: `0000_init` hand-edits three `CREATE SEQUENCE`s and the
  `jobs."searchVector"` generated `tsvector` column; the GIN/BRIN/trgm indexes are
  declared in the schema via `type: Gin/Brin` + `ops: raw(...)`.
