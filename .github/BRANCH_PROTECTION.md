# Branch Protection Settings

Apply these settings in **GitHub → Settings → Rules → Branch protection rules**
(or Rulesets) for both `main` and `develop`. CI provides the checks; these
settings make them required. A repo admin must apply this — a committed file
cannot self-enforce.

## Required for both `main` and `develop`

### Pull request
- **Require a pull request before merging** ✓
  - Required approvals: **1**
  - **Require review from Code Owners** ✓
    (makes CODEOWNERS paths — prisma/, auth/, payments/, rbac*, purge* — need a
    designated owner's approval in addition to the general approval)
  - Dismiss stale reviews when new commits are pushed ✓
  - Require conversation resolution before merging ✓
- **Do not allow bypassing the above settings** ✓ (applies to admins too)

### Status checks
- **Require status checks to pass before merging** ✓
- **Require branches to be up to date before merging** ✓
- Required checks (add each by exact job name):
  - `lint`
  - `typecheck`
  - `test`
  - `build`
  - `env-drift`
  - `migrate-check`
  - `e2e`
  - `security`
  - `pr-guards`   ← this is the migration-reviewed gate + size warning

### Push rules
- **Do not allow force pushes** ✓
- **Do not allow deletions** ✓

## Secret scanning (complementary to the gitleaks CI job)
In **Settings → Code security**:
- Enable **Secret scanning** ✓
- Enable **Push protection** ✓ (blocks pushes that contain known secret patterns)

The gitleaks CI job catches patterns GitHub's scanner may miss; push protection
catches known vendor token formats before they ever reach the repo.

## Notes
- `pr-guards` only runs on `pull_request` events (label checks require PR context).
  Direct pushes to `main`/`develop` are blocked by the above rules, so the gate
  is always exercised on the path to merge.
- The `migration-reviewed` label must exist in the repo before the gate can pass.
  Create it in **Issues → Labels**.
- Replace `@placeholder-*` handles in `.github/CODEOWNERS` with real GitHub
  usernames before the Code Owners requirement takes effect.
