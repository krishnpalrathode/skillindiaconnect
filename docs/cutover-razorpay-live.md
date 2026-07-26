# Cutover Runbook — Razorpay TEST → LIVE (C3)

**Status: PREPARED — NOT YET EXECUTED.** This document is the operating procedure for
taking real money live. Parts 1 (config verification) and 4 (rollback) are complete and
reviewed below. **Parts 2 and 3 take a real payment and MUST be run by a human operator
against the live Razorpay account**, with the values recorded into the "run log" tables
below AT THE TIME. Nothing in those tables is pre-filled — a pre-filled dashboard
cross-check would be a fabrication.

> This cutover swaps **credentials/config only** and PROVES the live wiring. It changes
> **no payment logic** — S5 built and hardened the routing, GST, activation transaction,
> invoice sequence and webhook dedupe; C3 does not touch them. (Verified: `git diff`
> for this unit is this file plus a `pnpm install` to sync the pre-existing `helmet`
> dependency — zero changes under `src/payments/`.)

---

## Roles (fill in before go-live)

| Role | Person | Notes |
| --- | --- | --- |
| **Go / no-go + rollback owner** (single decision-maker) | `__________` | Holds the abort call during Part 3. |
| Dashboard watcher (Razorpay live) | `__________` | Watches payment appear/capture/refund in real time. |
| Monitoring watcher (prod) | `__________` | Watches `/metrics`, logs, alert channel. |
| Operator (runs checkout + refund) | `__________` | The real approved employer account. |

---

## Pre-conditions — ALL must be CONFIRMED before Part 3 (not "pending")

Tick each with initials + timestamp. **If any is unmet, STOP at the end of Part 2.**

| # | Pre-condition | Confirmed (initials / time) |
| --- | --- | --- |
| 1 | Razorpay LIVE account **KYC approved** | `__________` |
| 2 | **International payments enabled** on the live account (the FOREIGN/Gulf path) | `__________` |
| 3 | Live **Key ID + Key Secret** present in the **production** secret store (by name — see Part 1) | `__________` |
| 4 | Live **webhook secret** in the production secret store — **distinct from the test secret** | `__________` |
| 5 | **Publicly-reachable** production `POST /api/v1/webhooks/razorpay` (Razorpay's servers can reach it) | `__________` |
| 6 | A **real payment method** for the smoke test + a person watching the dashboard live | `__________` |
| 7 | **Monitoring/alerting live in prod** (payment-activation-failure + webhook-lag alerts armed) — **see the ⚠️ BLOCKER below** | `__________` |
| 8 | *(Recommended)* full S1–S7 test pass green on the real stack (test-mode providers) so the live provider is the ONLY new variable | `__________` |

### ✅ GO/NO-GO BLOCKER found during Part-1 review — pre-condition #7 — RESOLVED

**Finding (at review time):** the Prometheus counters the money-path alerts fire on
**existed but were never emitted**. `MetricsService.recordActivation(...)` and
`recordWebhook(...)` were defined in
[metrics.service.ts](../apps/api/src/core/observability/metrics.service.ts) since S8-H3,
but `MetricsService` was **not injected anywhere under `src/payments/`** — no call sites.
`sic_payment_activations_total{outcome="failed"}` and `sic_webhook_events_total` would
have stayed at zero forever, so a metric-threshold alert could **never fire**: a payment
that silently failed to activate would page no one — the exact worst case this cutover
guards against.

**Resolution — option (a), the observability patch (no payment-logic change):**

- `WebhookService.process` now calls `recordWebhook(provider, outcome, ms)` on **every**
  terminal path — `rejected` (bad signature), `duplicate`, `error` (handler throw → the
  5xx-retry-storm signal), and the handler outcome (`activated` / `noop` / `unknown_order`
  / `marked_failed` / `stale_ignored` / `refunded` / …). It also records the
  `sic_webhook_processing_ms` histogram — the **webhook-lag** alert's source.
- `ActivationService.activate` now records `recordActivation('activated' | 'noop' |
  'failed')` — `failed` is emitted from a catch **before** the rethrow, so the alert fires
  even as the webhook returns 5xx. The activation transaction body was extracted into a
  private `runActivationTx` and the post-commit tail into `afterCommit`; **the SQL, the
  lock, the invoice sequence and the four writes are byte-for-byte unchanged** — this is
  wiring around the transaction, not inside it.
- Proof (Docker-free): `webhook-metrics.wiring.spec.ts` drives a real `MetricsService` and
  asserts the counters appear in the `/metrics` exposition (`outcome="rejected"`,
  `"activated"`, `"error"`). The full activation matrix (`webhooks.matrix.spec.ts`, 13/13)
  still passes with the metrics in place — logic intact.
- **Still TODO for the operator:** confirm the production **alert rules** target these
  metrics (the code now emits them; the alert config lives in your monitoring stack):

  | Alert | Metric it should watch | Configured in prod |
  | --- | --- | --- |
  | Payment-activation failure | `sic_payment_activations_total{outcome="failed"}` (rate > 0) | `__________` |
  | Webhook failure | `sic_webhook_events_total{outcome=~"error\|rejected"}` (rate) | `__________` |
  | Webhook lag | `sic_webhook_processing_ms` (p95 / bucket) | `__________` |

---

## Part 1 — Live configuration (VERIFIED in code; values supplied in the prod environment)

**How "live" is selected: by the KEYS, not a code flag.** There is no `RAZORPAY_MODE`
switch to set. Razorpay test-vs-live is entirely determined by whether the environment
holds `rzp_test_…` or `rzp_live_…` credentials. Domestic-vs-international is a Razorpay
**account-level** enablement (KYC + International-payments approval), also not a code
parameter. Confirmed in [razorpay.adapter.ts](../apps/api/src/payments/gateways/razorpay.adapter.ts)
(header comment + `orders.create` is identical for both markets).

### Secret-store references (by NAME — no value ever in code or this doc)

| Env var | Read at | Production value | Zod (boot-required) |
| --- | --- | --- | --- |
| `RAZORPAY_KEY_ID` | `RazorpayAdapter` ctor → SDK `key_id`; returned to Checkout.js | **LIVE** `rzp_live_…` | `z.string().min(1)` — API will not boot without it |
| `RAZORPAY_KEY_SECRET` | `RazorpayAdapter` ctor → SDK `key_secret` | **LIVE** secret | `z.string().min(1)` |
| `RAZORPAY_WEBHOOK_SECRET` | `RazorpayAdapter.verifyWebhook` (HMAC-SHA256, constant-time) | **LIVE webhook secret** (≠ test) | `z.string().min(1)` |

Verification performed:

- ✅ No key literal anywhere in the codebase: `grep -rn "rzp_test\|rzp_live\|key_test"
  src` → **no matches**. Keys come only from `ConfigService.get(...)`.
- ✅ The verifier reads `RAZORPAY_WEBHOOK_SECRET` and **throws** (does not silently pass)
  if it is missing — a blank/absent secret fails closed, it does not accept unsigned
  events.
- ✅ Same code, different secrets per environment: staging holds test keys, production
  holds live keys, both injected from the secret store. Nothing environment-specific is
  hardcoded.
- ✅ FOREIGN path uses the **same live keys** with international enabled on the account
  ([routing.service.ts](../apps/api/src/payments/routing.service.ts): `LOCAL → RAZORPAY
  DOMESTIC`, `FOREIGN → RAZORPAY INTERNATIONAL` unless `payments.stripe_enabled` +
  Stripe key — Stripe is **out of scope** here and stays off).

**Production checklist (operator confirms in the prod environment):**

- [ ] `RAZORPAY_KEY_ID` in prod secret store starts with `rzp_live_` (NOT `rzp_test_`).
- [ ] `RAZORPAY_KEY_SECRET` in prod secret store is the **live** secret.
- [ ] `RAZORPAY_WEBHOOK_SECRET` in prod secret store is the **live webhook secret** (the
      value you will paste into the dashboard in Part 2 — they MUST match).
- [ ] `payments.stripe_enabled` setting is **off** (this cutover is Razorpay-only).
- [ ] API booted cleanly with the live keys (no `GATEWAY_UNAVAILABLE`, no boot error).

---

## Part 2 — Register + verify the live webhook (the crux — gates Part 3)

Everything depends on Razorpay's LIVE webhook reaching production and verifying against
the live secret. **A real payment on a broken webhook takes the money and activates
nothing — the worst outcome.** Do NOT proceed to Part 3 until every box here is ticked.

**Endpoint:** `POST https://<PROD_HOST>/api/v1/webhooks/razorpay`
(`@Public`, `@SkipThrottle` — the HMAC signature is the auth; unversioned prefix is
`/api/v1`). Handled Razorpay event families
([payment-events.handler.ts](../apps/api/src/payments/webhooks/handlers/payment-events.handler.ts)):

| Razorpay event | Family | Effect |
| --- | --- | --- |
| `order.paid` | success | activation transaction (idempotent on current order state) |
| `payment.captured` | success | activation transaction |
| `payment.failed` | failure | audit only; **never regresses a PAID order** |
| `refund.processed` | refund | order → REFUNDED + `payment.refunded` audit |

**Dashboard steps (Razorpay live mode):**

- [ ] Add webhook URL = the exact production URL above.
- [ ] Subscribe to at least: `order.paid`, `payment.captured`, `payment.failed`,
      `refund.processed`.
- [ ] Set the dashboard webhook **secret** = the exact `RAZORPAY_WEBHOOK_SECRET` value in
      production. **This is the #1 cutover failure — a mismatch 401s every live webhook.**

**Prove it BEFORE any real payment (send-sample / test-webhook from the dashboard):**

| Check | Expected | Observed | Pass |
| --- | --- | --- | --- |
| Sample event **arrives** at prod endpoint | request appears in prod logs / `webhook.received` audit | `__________` | ☐ |
| Signature **verifies** against the live secret | **200**, not 401; no `webhook.rejected` audit | `__________` | ☐ |
| Unknown-order sample | **200** + `webhook.unknown_order` audit (not a 4xx/5xx) | `__________` | ☐ |
| A deliberately **wrong** signature | **401** `INVALID_SIGNATURE` + `webhook.rejected` audit (reason only, no payload) | `__________` | ☐ |

**If the sample does not arrive, or 401s against the live secret → STOP. Fix the secret /
reachability. Do not take real money.**

---

## Part 3 — The real-transaction smoke test (run ONLY after Parts 1–2 pass)

Run with the dashboard watcher AND monitoring watcher live. Use the smallest real charge
that still exercises the real path (the plan's real price if a full refund is acceptable;
otherwise the smallest purchasable plan). **The client callback activates NOTHING —
activation is webhook-only. The UI must show "Confirming your payment…" and flip to
success ONLY after the real webhook lands.**

### 3a. Purchase — run log

| Field | Value |
| --- | --- |
| Date / time (start) | `__________` |
| Operator employer (company, type LOCAL/FOREIGN) | `__________` |
| Plan code / price | `__________` |
| Our order id (CREATED) | `__________` |
| Razorpay gateway order id (`order_…`) | `__________` |
| Razorpay payment id (`pay_…`) | `__________` |

Watch the chain:

- [ ] Order created **CREATED**; UI shows "Confirming your payment…", **not** success.
- [ ] Real Razorpay Checkout completes with a real payment method.
- [ ] **Live webhook fires** → reaches prod → verifies → activation transaction runs.
- [ ] UI polling flips to **success only after** the webhook (no client-side activation).

### 3b. Activation cross-check (our records vs the Razorpay dashboard MUST agree)

| Field | Our system | Razorpay dashboard | Agree? |
| --- | --- | --- | --- |
| Amount (incl. GST for LOCAL) | `__________` | `__________` | ☐ |
| Status | order **PAID** | captured / paid | ☐ |
| Subscription | **ACTIVE** | — | ☐ |
| Invoice number (next `SIC-…` sequential) | `__________` | — | ☐ |
| `SUBSCRIPTION_PURCHASED` notification | delivered (email/in-app) | — | ☐ |
| Audit rows | `webhook.received`, activation, invoice | — | ☐ |
| **Invoice PDF** (S7-B1) | `pdfKey` populated; download works | — | ☐ |

### 3c. Refund — do not leave a stray real charge

| Field | Value |
| --- | --- |
| Refund id (`rfnd_…`) | `__________` |
| Refund initiated at / by | `__________` |

- [ ] Issue the refund (dashboard or admin path).
- [ ] `refund.processed` **live webhook** fires → reaches prod → order **REFUNDED** +
      `payment.refunded` audit. *(MVP: no subscription clawback — the refund is recorded,
      the subscription is not auto-revoked; note it and handle manually if required.)*
- [ ] Refund cross-checked in the dashboard (amount + status agree).

### 3d. Monitoring confirmation

- [ ] Activation visible in the money-path signal confirmed in pre-condition #7
      (metric `sic_payment_activations_total{outcome="activated"}` **if** #7(a) was done,
      otherwise the log/audit signal from #7(b)).
- [ ] Webhook processing visible (`sic_webhook_events_total` / `webhook_events` rows).
- [ ] Failure-alert path armed (config targets the right signal — confirm, don't assume).

### 3e. Idempotency under a REAL redelivery (recommended)

Razorpay retries webhooks. Trigger a redelivery from the dashboard (or observe a natural
retry) and confirm the `(provider, eventId)` dedupe holds:

- [ ] Redelivered event → **200**, `webhook.duplicate` audit, **no** second activation,
      **no** second invoice number consumed.

---

## Part 4 — Rollback (READY BEFORE Part 3 — do not improvise during an incident)

**Decision owner:** the named go/no-go owner above holds the abort call.

### Stop taking real money FAST (config actions, no redeploy)

1. **App-side kill switch — preferred.** Set every paid `Plan.isActive = false`
   (DB / admin settings action). Checkout then returns **422 `PLAN_NOT_PURCHASABLE`**
   immediately ([checkout.service.ts](../apps/api/src/payments/checkout.service.ts) plan
   gate), so **no new orders are created** — while existing subscriptions keep working.
   Reverse by flipping `isActive` back to `true`.
   ```sql
   -- disable
   UPDATE plans SET "isActive" = false WHERE "priceSubunits" > 0;
   -- re-enable
   UPDATE plans SET "isActive" = true  WHERE "priceSubunits" > 0;
   ```
2. **Revert credentials to test.** Point the prod `RAZORPAY_*` secrets back to the
   **test** keys + restart. Checkout then creates test-mode orders (no real charge). This
   is the "same code, different secrets" reversal — a secret-store change, not a code
   deploy. *(Note: the API requires the keys to boot, so blanking them is NOT a valid
   rollback — swap to test values, don't remove.)*

### Pause / disable the webhook (if it misbehaves)

- In the Razorpay live dashboard, **disable** (or delete) the webhook. Incoming events
  stop; already-CREATED orders will not auto-activate until it is restored. Combine with
  #1 above so no new orders pile up behind a paused webhook.

### A payment taken but NOT activated (a stranded customer)

The money path is designed so this is recoverable, not lost:

1. The paid order exists as **CREATED** with the Razorpay `pay_…` id; the payment shows
   **captured** in the dashboard. No invoice, no active subscription yet.
2. **Re-drive the webhook:** re-deliver the `payment.captured` / `order.paid` event from
   the dashboard. The handler activates on **current order state** (idempotent) — a
   redelivery is the intended recovery, and the dedupe won't swallow it because the prior
   attempt is absent or `ERROR`.
3. If the webhook cannot be re-driven (e.g. secret still broken): fix Part 1/2 first, THEN
   redeliver. Do **not** hand-activate by mutating rows outside the activation transaction
   (it would skip the sequential invoice + notification + audit and break the invariant).
4. If the customer must be made whole immediately and activation cannot be completed:
   **refund** them in the dashboard (order → REFUNDED via the refund webhook once Part 2
   is healthy) and re-attempt the purchase after the fix. A refunded customer is never
   left charged-without-service.

---

## Sign-off

| Gate | By | Time |
| --- | --- | --- |
| Pre-conditions 1–8 confirmed (incl. #7 resolved) | `__________` | `__________` |
| Part 2 webhook verified reachable + verifying | `__________` | `__________` |
| Part 3 real transaction + refund + cross-check complete | `__________` | `__________` |
| Rollback rehearsed / understood by the owner | `__________` | `__________` |
| **GO-LIVE declared** | `__________` | `__________` |
