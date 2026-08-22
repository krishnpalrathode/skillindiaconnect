# Railway Deployment Configuration

All deployment configuration lives in Railway, not in this repository. This file
documents what to set so future team members can recreate the setup.

## Service layout

Three Railway services, all built from this single repository:

| Service  | Start command                              | Runs migrations?                      |
| -------- | ------------------------------------------ | ------------------------------------- |
| `web`    | `node apps/web/.next/standalone/server.js` | No                                    |
| `api`    | `node apps/api/dist/main.api`              | **Yes** (release command — see below) |
| `worker` | `node apps/api/dist/main.worker`           | **No**                                |

`api` and `worker` build from the **same api image** (same Dockerfile, same dist);
only the start command differs.

## Release command (api service only)

Set the **Release command** on the `api` service in Railway to:

```
pnpm --filter ./apps/api exec prisma migrate deploy
```

This runs **before** new containers take traffic (Railway's pre-deploy phase).
Because every migration follows the expand → backfill → contract rule
(see `.claude/rules/migrations.md`), the migration is always backward-compatible
with the currently-running container version — zero-downtime deploys are safe.

**The `worker` service must NOT have a release command.** Exactly one migrator
prevents concurrent double-apply.

## Environment variables

Configure per-service env vars in Railway's variable panel (or shared variables
for values common to api + worker). The api and worker both validate vars at boot
via the Zod schema in `packages/shared-config/src/env.schema.ts` — misconfigured
vars cause a fast boot failure, not silent misbehavior.

Required vars for `api` and `worker`:

| Variable       | Example (staging)                   |
| -------------- | ----------------------------------- |
| `NODE_ENV`     | `staging` or `production`           |
| `DATABASE_URL` | Railway managed Postgres plugin URL |
| `REDIS_URL`    | Railway managed Redis plugin URL    |
| `PORT`         | Set by Railway automatically        |

Required vars for `web`:

| Variable              | Example                           |
| --------------------- | --------------------------------- |
| `NEXT_PUBLIC_API_URL` | `https://api.staging.example.com` |

### Optional: LinkedIn sign-in

Unlike `GOOGLE_OAUTH_*`, the LinkedIn variables are **optional**. Leave them
unset and the provider is simply not registered — the API boots normally and
`/auth/linkedin` redirects to `/login?error=LINKEDIN_UNAVAILABLE`. Set all three
to turn it on; setting only some counts as unset.

| Variable                        | Example                                                  |
| ------------------------------- | -------------------------------------------------------- |
| `LINKEDIN_OAUTH_CLIENT_ID`      | From the LinkedIn app's Auth tab                          |
| `LINKEDIN_OAUTH_CLIENT_SECRET`  | From the LinkedIn app's Auth tab                          |
| `LINKEDIN_OAUTH_CALLBACK_URL`   | `https://api.example.com/api/v1/auth/linkedin/callback`   |

Before the keys will work, in the [LinkedIn Developer Portal](https://www.linkedin.com/developers/apps):

1. The app must be associated with a LinkedIn **Company Page**.
2. Products tab → request **Sign In with LinkedIn using OpenID Connect**. The
   keys alone are not enough — without this product LinkedIn rejects the
   `openid` scope at the consent screen.
3. Auth tab → add `LINKEDIN_OAUTH_CALLBACK_URL` to **Authorized redirect URLs**,
   matching byte for byte including scheme and path.

Each environment needs its OWN redirect URL registered; staging and production
cannot share one entry.

## Deployment triggers

| Branch    | Environment | Trigger                    |
| --------- | ----------- | -------------------------- |
| `develop` | Staging     | Railway GitHub integration |
| `main`    | Production  | Railway GitHub integration |

Both branches are protected (PRs must pass all CI checks before merge), so the
deployed commit is already CI-vetted. **CI does not run the deploy** — Railway
handles it after merge.

## Database

Use Railway's managed **Postgres** plugin. Default local DB name:
`skillindiaconnect_dev`. Staging and production use Railway-provisioned databases.

## PITR decision pending

Point-in-time recovery (PITR) with RPO ≤ 5 min is planned for Phase 6. Confirm
with the account owner which Railway plan tier includes PITR before that phase
begins — it may require an upgrade.
