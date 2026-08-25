-- Sign In with LinkedIn (OpenID Connect) — the account link.
--
-- ONE nullable column plus its unique index. Additive and backward-compatible
-- in both directions: code that predates this migration never reads or writes
-- the column, and code that follows it treats NULL as "no LinkedIn linked",
-- which is what every existing row is. So `prisma migrate deploy` is safe to
-- run BEFORE the new containers take traffic (migrations.md, zero-downtime).
--
-- No expand→backfill→contract here: nothing is being narrowed and there is no
-- old shape to stop writing. There is nothing to backfill either — a LinkedIn
-- subject cannot be derived from data we already hold.
--
-- The value stored is the OIDC `sub`, which LinkedIn issues PAIRWISE (one value
-- per application). It is therefore meaningless outside this app and must not
-- be treated as a portable LinkedIn member id.
--
-- UNIQUE is the load-bearing part: it is what stops one LinkedIn identity from
-- being attached to two accounts, including under two concurrent first-time
-- sign-ins that both read "no such user" before either writes.
--
-- IF NOT EXISTS on both statements so a re-run cannot fail.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "linkedinId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "users_linkedinId_key" ON "users"("linkedinId");
