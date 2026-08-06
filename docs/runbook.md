# SkillIndiaConnect — Operations Runbook

**Audience: whoever is on call, at 3am, who did not write this system.**

Every procedure is a numbered list of commands with an explicit stopping
condition. Where a decision is required, the decision criteria are stated
inline — you should not have to reason from architecture to act.

- **Symptom → section:** use the index below.
- **Accepted limitations** (things that are deliberately not built, and who they
  affect during an incident): [known-deferrals.md](./known-deferrals.md).
- Every alert in `observability/alerts.yml` carries a `runbook:` label pointing
  at a section here.
- Behaviour claims in this document were verified by injection in S8-H3; see
  `docs/chaos-report.md`.

---

## 0. Index — symptom to section

| Symptom / alert | Section |
|---|---|
| `WorkerMemoryApproachingCeiling`, `WorkerMemoryCritical` | [Worker memory](#worker-memory) |
| `WorkerRestartLoop`, worker keeps dying | [Worker crash](#worker-crash) |
| `NotificationQueueStarving`, `RenderQueueBackingUp`, `DeadLetterAccumulating` | [Queue backup](#queue-backup) |
| `ElevatedServerErrorRate` | [Elevated 5xx](#elevated-5xx) |
| `ApiLatencyDegraded` | [Latency](#latency) |
| `PaymentActivationFailures`, `WebhookProcessingSlow` | [Payments](#payments) |
| `WhatsappOtpSendFailures`, `WhatsappNotificationFailures`, "nobody can log in by phone" | [WhatsApp](#whatsapp) |
| `AuthFailureSpike`, `RateLimitSaturation` | [Auth spike](#auth-spike) |
| `ApiInstanceNotReady`, API unreachable | [API down](#api-down) |
| `DatabasePoolNearExhaustion` | [DB pool](#db-pool) |
| 503 `SESSION_VERIFICATION_UNAVAILABLE`, cache errors | [Redis outage](#redis-outage) |
| Documents 404, uploads failing | [Storage outage](#storage-outage) |
| **Data loss / corruption / "we need to restore"** | [**Restore**](#restore) |

## 0.1 First 60 seconds of any incident

```bash
curl -s $API/health        # {"status":"ok"|"degraded","db":…,"redis":…}
curl -s $API/health/ready  # {"status":"ready"|"not_ready"}
curl -s $API/metrics | grep -E 'sic_process_resident_memory_bytes|sic_queue_oldest_waiting_age_ms'
```

`/health` names the broken dependency immediately. That answer routes you to the
right section below — do not start guessing before you have read it.

**Correlation.** Every log line carries `requestId`; responses return it as
`x-request-id`. Given a user report with that header, one search reconstructs
the whole request:

```
requestId:"<id>"
```

---

## <a id="restore"></a>1. RESTORE FROM BACKUP

> Read [§1.0](#restore-decide) before touching anything. A restore is
> destructive: it discards everything written since the backup.

### <a id="restore-decide"></a>1.0 Decide whether to restore

| Situation | Action |
|---|---|
| Data *incorrect* but present (bad migration, bad bulk update) | **Prefer a targeted fix.** A full restore loses every unrelated write since the backup. |
| Data *destroyed* (dropped table, corruption, ransomware) | **Restore.** Continue below. |
| Only object storage affected (documents missing) | **Do NOT restore the database.** Go to [§1.5](#restore-objects). |

**Before restoring, announce it.** Everything written between the backup and now
will be lost. Someone needs to know which customers that affects.

### 1.1 Stop writes

```bash
# Scale the API and worker to zero so nothing writes during the restore.
railway service scale api --replicas 0
railway service scale worker --replicas 0
```
✅ **Stop when:** `/health` no longer answers from any instance.

Do not skip this. A restore into a live database produces a half-old, half-new
state that is worse than either.

### 1.2 Identify the recovery point

```bash
railway backups list --service postgres
```

Pick the most recent backup **before** the incident. Note its timestamp — call it
**T1**. Everything after T1 is lost; that is the RPO you are accepting.

> ⚠️ **Known gap.** PITR is not yet configured (see
> `docs/backup-restore-drill.md`). Your recovery point is the last **snapshot**,
> not an arbitrary second. If snapshots are daily, T1 may be up to 24 hours ago.

### 1.3 Restore the database

**Managed (Railway) — preferred:**
```bash
railway backups restore --service postgres --backup <BACKUP_ID>
```

**From a `pg_dump` archive — the drilled path:**
```bash
# 1. Recreate an empty database
psql "$ADMIN_URL" -c 'DROP DATABASE IF EXISTS skillindiaconnect WITH (FORCE);'
psql "$ADMIN_URL" -c 'CREATE DATABASE skillindiaconnect;'

# 2. Restore
pg_restore -d "$DATABASE_URL" --no-owner --no-privileges backup.dump

# 3. Confirm the schema is at the expected migration
psql "$DATABASE_URL" -c \
  'SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 3;'
```
✅ **Stop when:** `pg_restore` exits 0 and the migration list looks current.
⏱️ **Expect ~5s per 15MB of dump** (measured: 5.1s for 14.6MB / 51k applications).

### 1.4 Verify integrity BEFORE restoring traffic

Do not skip this. A restore that silently lost referential integrity is worse
than a visible outage, because you will not find out for days.

```sql
-- Orphans: all three MUST be 0
SELECT count(*) FROM applications a LEFT JOIN jobs j ON j.id=a."jobId" WHERE j.id IS NULL;
SELECT count(*) FROM invoices i     LEFT JOIN orders o ON o.id=i."orderId" WHERE o.id IS NULL;
SELECT count(*) FROM jobs j         LEFT JOIN companies c ON c.id=j."companyId" WHERE c.id IS NULL;

-- GST sequence MUST be >= the highest issued number, or invoice numbers repeat.
SELECT last_value FROM invoice_number_seq;
SELECT COALESCE(MAX(split_part(number,'-',3)::int),0) FROM invoices;
```

❌ **If the sequence is behind**, fix it before serving traffic — a re-issued GST
number is a legal problem:
```sql
SELECT setval('invoice_number_seq',
  (SELECT COALESCE(MAX(split_part(number,'-',3)::int),0)+1 FROM invoices));
```

### <a id="restore-objects"></a>1.5 Reconcile object storage

The database restores to **T1**; R2 is still at **now**. Two mismatches follow:

- **Dangling keys** — rows pointing at objects deleted after T1. Users see a
  document that 404s.
- **Orphaned objects** — objects nothing references. Wasted storage only.

```sql
-- Surface of the problem
SELECT count(*) FROM candidate_documents WHERE "r2Key" IS NOT NULL;
SELECT count(*) FROM invoices WHERE "pdfKey" IS NOT NULL;
SELECT count(*) FROM resume_generations WHERE "r2Key" IS NOT NULL;
```

For each key whose object is missing: restore the object version (bucket
versioning) **or** null the reference so the app degrades honestly instead of
serving a broken link. Invoice PDFs need neither — the daily backfill sweep
re-renders any invoice with `pdfKey` null.

> 🔴 **If the restore crosses a DPDP purge**, a user erased after T1 is now
> resurrected in the database while their objects are gone. **Re-run the purge
> for those users immediately** — this is a privacy obligation, not a cleanup
> task.
> ```sql
> SELECT id FROM users WHERE status='PENDING_DELETION' AND "purgedAt" IS NULL;
> ```

### 1.6 Restore service

```bash
railway service scale api --replicas 2
railway service scale worker --replicas 1
curl -s $API/health/ready   # expect {"status":"ready"}
curl -s "$API/api/v1/jobs?q=electrician" | head -c 200
```
✅ **Stop when:** readiness is `ready` and a real search returns results.

### 1.7 After the incident

- Record the actual RPO (T1 → incident) and RTO (incident → step 1.6).
- Re-run `pnpm chaos:drill` in staging to confirm the path still works.
- If the RPO exceeded 5 minutes — **it will, until PITR is configured** — escalate
  as a business risk, not a technical one.

---

## <a id="worker-memory"></a>2. Worker memory approaching the ceiling

**Why this pages:** the worker is shared. An OOM there kills payment webhooks and
notifications along with renders (S8-H1).

```bash
curl -s $WORKER/metrics | grep sic_process_resident_memory_bytes
curl -s $API/metrics    | grep 'sic_queue_depth{queue="resume-render"'
```

| Reading | Action |
|---|---|
| RSS > 800 MB **and** render queue deep | A render burst. Reduce `RENDER_POOL_CONCURRENCY` to 1 and redeploy the worker. |
| RSS > 800 MB **and** queues idle | A leak. Restart the worker (safe — see §3) and open a bug. |
| RSS climbing steadily over days | A leak. Schedule a rolling restart; investigate with the S8-H1 soak script. |

**Sizing reference (measured, S8-H1):**

| Pool cap | Peak tree RSS | Verdict on a 1GB worker |
|---|---|---|
| 1 | ~555 MB | safe |
| **2** | **~515–680 MB** | **recommended default** |
| 4 | ~1095 MB | **breaches 1GB** |
| 8 | ~1789 MB | requires a 2GB+ container |

⚠️ `RENDER_POOL_CONCURRENCY` is a **memory** knob, not a throughput knob. Never
raise it without raising the container limit first.

---

## <a id="worker-crash"></a>3. Worker crashed / restart loop

**Restarting the worker is SAFE.** Verified under SIGKILL mid-render (S8-H3):

- In-flight jobs are redelivered by BullMQ — nothing is lost.
- Chromium children do not survive the parent — no zombies accumulate.
- Redelivering the same payment webhook after a crash does **not** double-activate,
  double-invoice or double-charge.

```bash
railway logs --service worker | tail -100     # look for OOM / uncaught exceptions
railway service restart worker
curl -s $API/metrics | grep sic_queue_depth   # queues should drain after restart
```

If it crash-loops: check `sic_process_uptime_seconds` resetting, then look for a
**poison job** — one job that kills the process on every attempt:

```bash
curl -s $API/metrics | grep 'state="failed"'
```
Remove the offending job from the queue rather than letting it roll the worker.

---

## <a id="queue-backup"></a>4. Queue backing up / consumers starved

**This is H1's blast radius.** Depth alone hides starvation — check **age**:

```bash
curl -s $API/metrics | grep sic_queue_oldest_waiting_age_ms
```

| Pattern | Meaning | Action |
|---|---|---|
| `notification` ageing, `resume-render` deep | Renders are starving other consumers | Reduce `RESUME_RENDER_CONCURRENCY`; consider a dedicated render worker |
| One queue ageing, others fine | That consumer is stuck | Restart the worker (§3) |
| All queues ageing | The worker is dead or Redis is down | §3, then [§8](#redis-outage) |
| `state="failed"` climbing | Retries exhausted — work is now genuinely lost | Inspect the job payloads before requeueing |

---

## <a id="payments"></a>5. Payment activation failures

**Treat as revenue-affecting and act immediately.** A failed activation may mean
money captured without service delivered.

```bash
curl -s $API/metrics | grep sic_payment_activations_total
```
```sql
-- Orders paid at the gateway but not activated here
SELECT id, status, "createdAt" FROM orders
 WHERE status='CREATED' AND "createdAt" < now() - interval '30 minutes'
 ORDER BY "createdAt" DESC LIMIT 50;

-- Webhooks received but errored
SELECT provider, "eventId", status, "processedAt" FROM webhook_events
 WHERE status='ERROR' ORDER BY "createdAt" DESC LIMIT 50;
```

1. **Reconcile against the gateway dashboard** — is the money actually captured?
2. If captured but the order is `CREATED`, **re-deliver the webhook from the
   gateway's dashboard.** Do not hand-edit the order: activation is
   webhook-only by design, and re-delivery is safe (verified idempotent across
   concurrent delivery *and* crash-restart).
3. If the webhook errored, the `ERROR` status makes a gateway retry re-process it
   — the dedupe deliberately does not swallow retries after a failure.

**A gateway outage is not an incident for us.** Verified (S8-H3): a refused or
timing-out gateway leaves the order `FAILED` with no invoice, no subscription and
no payment row, and the client gets a `502` — never a false success. When the
gateway recovers, normal webhooks activate correctly.

---

## <a id="whatsapp"></a>5.1 WhatsApp send failures / phone login down

**`WhatsappOtpSendFailures` is a LOGIN AVAILABILITY incident, not a notification
problem.** WhatsApp is currently the only OTP transport, so while it is down
nobody can sign in by phone.

**Who is still able to get in** (say this to support, it is the whole triage):

| User | Route in |
|---|---|
| Signed up with email + password | Email tab — works normally |
| Signed up with Google | **Continue with Google** — works normally |
| Signed up by phone, no password set | **Blocked.** No route until WhatsApp recovers |

```bash
curl -s $API/metrics | grep sic_whatsapp_sends_total
curl -s $API/metrics | grep sic_whatsapp_delivery_status_total
```
```sql
-- What is actually failing, and with which provider code
SELECT kind, "templateName", status, "errorCode", count(*)
  FROM whatsapp_messages
 WHERE "createdAt" > now() - interval '1 hour'
 GROUP BY 1,2,3,4 ORDER BY 5 DESC;
```

1. **Check the access token first.** An expired System User token presents
   EXACTLY like a Meta outage — every send fails, nothing else changes. If
   `errorCode` is `META_190` or the sends began failing all at once with no
   Meta status-page incident, assume the token.
2. **Check [status.fb.com](https://status.fb.com)** for a genuine Cloud API incident.
3. **`META_132001` — "template does not exist" almost always means the WRONG
   LOCALE, not a missing template.** `en` and `en_US` are different templates to
   Meta. Check `WHATSAPP_TEMPLATE_LANGUAGE` against the locale shown on the
   template in WhatsApp Manager; it must match, on **both** services. Fixing it
   is an env change + restart, not a deploy.
4. **`errorCode` tells you which failure it is:**
   `TEMPLATE_NOT_MAPPED` / `TEMPLATE_PARAM_MISMATCH` / `DOCUMENT_MISSING` are
   OUR bugs from a recent deploy, not Meta — roll back rather than wait.
   A template Meta un-approved also fails here.
4. **If it is a real Meta outage, the mitigation is to stop pretending.**
   `WHATSAPP_PROVIDER=mock` on both services makes sends fail fast instead of
   burning the 10s timeout on every login request — the API sends OTPs inline,
   so a hanging Meta is added latency on the login path for EVERYONE, including
   the users whose route in still works.
5. **Tell support the table above.** The one genuinely blocked group is
   phone-signup users with no password; they must wait.

**`WhatsappNotificationFailures` (warning) is different** — those degrade to
email. Confirm the fallback is actually running before standing down:

```sql
SELECT status, count(*) FROM email_messages
 WHERE "createdAt" > now() - interval '1 hour' GROUP BY 1;
```

**Sends succeeding but nothing arriving** is the third shape: check
`sic_whatsapp_delivery_status_total`. If sends are `sent` and no `DELIVERED`
statuses are arriving at all, the WEBHOOK is broken, not the sending — verify the
subscription in the Meta dashboard and see
[whatsapp-integration.md](./whatsapp-integration.md#the-webhook).

---

## <a id="auth-spike"></a>6. Auth failure / rate-limit spike

```bash
curl -s $API/metrics | grep -E 'sic_auth_failures_total|sic_rate_limit_hits_total'
```

1. **Is it one source or many?** Search logs for the spike and group by client.
2. **Is it distributed?** Credential stuffing across many IPs will show as a high
   401 rate with low per-IP rate-limit hits.
3. ⚠️ **Rate limits are currently per-replica** (in-memory storage — H2 SEC-007).
   With N replicas the effective limit is N× the configured value. Factor that in
   before concluding the limiter is working.
4. Mitigation: tighten `RATE_LIMIT_GLOBAL_PER_MIN`, or block at the edge/CDN.
   Application-level limiting is not the right tool against a large botnet.

---

## <a id="elevated-5xx"></a>7. Elevated 5xx rate

```bash
curl -s $API/metrics | grep sic_http_server_errors_total   # which route?
railway logs --service api | grep '"level":"error"' | tail -50
```

Then check dependencies first — most 5xx spikes are downstream:

```bash
curl -s $API/health   # names the broken dependency directly
```

| `/health` says | Go to |
|---|---|
| `redis: down` | [§8](#redis-outage) |
| `db: down` | [§9](#api-down) |
| everything `up` | An application bug. Find the `requestId` in the error logs and trace it. |

---

## <a id="redis-outage"></a>8. Redis outage

**Expected behaviour** (verified S8-H3), so you know what is normal:

| Surface | Behaviour with Redis down |
|---|---|
| Public search / job detail | ✅ **keeps working** — degrades to Postgres |
| Authenticated requests | ❌ `503 SESSION_VERIFICATION_UNAVAILABLE` |
| Authorization | ✅ **fails closed** — never grants anything it should not |
| `/health` | ✅ answers in ~2s with `redis: down` |
| Recovery | ✅ automatic, ~1s after Redis returns — **no redeploy needed** |

> **Why authenticated traffic stops.** The session-revocation list exists only in
> Redis. Failing open would make logout stop meaning logout during an outage, so
> the system fails closed deliberately. This is an accepted trade-off, recorded
> in `docs/chaos-report.md` with the fix (a DB-backed revocation table) as
> follow-up.

**Actions:**
1. **Do not restart the API.** It recovers on its own; a restart only discards
   warm connections. (Liveness deliberately ignores Redis for this reason.)
2. Restore Redis: `railway service restart redis`.
3. Confirm: `curl -s $API/health` → `redis: up`, then an authenticated request.

---

## <a id="storage-outage"></a>9. Object storage outage

**Expected behaviour** (verified S8-H3):

- Document uploads fail cleanly — **no phantom rows** are created.
- Renders fail and retry; a generation is **never** marked `READY` without bytes.
- An in-flight DPDP purge commits its DB half, does **not** claim completion, and
  **resumes correctly** when storage returns.

**Actions:** restore the bucket, then let BullMQ retries drain. Check for work
that exhausted its retries:
```bash
curl -s $API/metrics | grep 'state="failed"'
```
```sql
-- Purges that committed the DB half but never completed
SELECT id FROM users WHERE status='PENDING_DELETION' AND "purgedAt" IS NOT NULL;
```
Re-enqueue any exhausted purge; re-entry is idempotent and writes exactly one
completion audit.

---

## <a id="api-down"></a>10. API unreachable / database down

```bash
curl -s $API/health/live    # process alive?
curl -s $API/health/ready   # dependencies ready?
```

| live | ready | Meaning | Action |
|---|---|---|---|
| ✅ | ✅ | The app is fine | Look at the load balancer / DNS / TLS |
| ✅ | ❌ | Process healthy, **DB unreachable** | Fix Postgres. **Do not restart the API** — it reconnects in ~100ms (verified). |
| ❌ | ❌ | Event loop wedged | Restart the instance |
| no answer | — | Process dead | Check platform logs for OOM |

**Database outage behaviour** (verified): reads and writes are refused honestly —
never partial or fabricated data — interrupted transactions roll back with no
half-written rows, readiness flips to `not_ready` so traffic stops routing, and
recovery on reconnect is automatic without a restart.

---

## <a id="db-pool"></a>11. Database connection pool near exhaustion

Pool exhaustion presents as latency that looks like an application bug (S8-H1).

```sql
SELECT count(*) AS in_use, (SELECT setting::int FROM pg_settings WHERE name='max_connections') AS max
  FROM pg_stat_activity WHERE datname = current_database();
```

Prisma defaults to `num_cpus × 2 + 1` **per process**, which is invisible until a
burst exhausts it. Set it explicitly and size the sum across every process:

```
DATABASE_URL=postgresql://…/db?connection_limit=20&pool_timeout=10
```
Keep `(api replicas + worker) × connection_limit` under Postgres'
`max_connections`.

---

## <a id="latency"></a>12. API latency degraded

```bash
curl -s $API/metrics | grep sic_http_request_duration_ms_bucket   # which route?
```

Reference (S8-H1): public search saturates near **1,000 rps** at p95 well under
200 ms. A p95 above 1 s is structural — check in this order:

1. **A lost index.** `EXPLAIN ANALYZE` the search query; it must use
   `jobs_searchVector_idx` + `jobs_title_idx` via BitmapOr, and the landing page
   must use `jobs_status_publishedAt_idx`. A Seq Scan here is the known
   regression shape.
2. **Cache hit rate collapsed** — check whether Redis is healthy (§8).
3. **DB pool saturation** (§11).

---

## 13. Deployment safety notes

- **Migrations run before new containers take traffic.** Every migration must be
  backward-compatible with the currently-running code (expand → backfill →
  contract). Never ship destructive DDL with the code that stops writing the old
  shape.
- **`/metrics` must not be internet-facing.** It exposes no PII (route labels are
  path templates, never ids) but it does expose internal topology. Restrict it at
  the network layer.
- **Liveness must stay dependency-free.** Adding a DB check to `/health/live`
  would make a database blip roll the entire fleet.
- **Set `LOG_FORMAT=json`** in staging and production; leave it unset locally.
  `LOG_LEVEL` defaults to `log` so debug output cannot ship by accident.
