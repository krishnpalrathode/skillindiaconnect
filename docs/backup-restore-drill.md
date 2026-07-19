# S8-H3 — Backup / Restore Drill Report

**The drill was actually performed**, against a genuinely destroyed database,
and both numbers were measured rather than assumed.

Re-run with `pnpm chaos:drill`. It operates on a disposable `*_drill` database
it creates and drops; the development database is never touched.

---

## Headline

| | Target | Measured | Verdict |
|---|---|---|---|
| **RTO** (incident → service restored) | ≤ 60 min | **14.4 s** | ✅ **Comfortably met** |
| **RPO** (data lost) | ≤ 5 min | **2.1 s** *in the drill window* | ⚠️ **Not evidence for production — see below** |
| Post-restore integrity | consistent | 10/10 checks pass | ✅ |

### ⚠️ THE MOST IMPORTANT FINDING: the RPO target is NOT met in production

The drill proves the **restore path works**. It does **not** prove the RPO
target is met, and it must not be read that way.

The 2.1 s figure is the length of *this drill's* write window — the gap between
taking the backup and the simulated incident. It is a property of the test, not
of production.

**In production, RPO equals the backup interval.** And today:

> `.github/DEPLOYMENT.md`: *"Point-in-time recovery (PITR) with RPO ≤ 5 min is
> planned for Phase 6. Confirm with the account owner which Railway plan tier
> includes PITR before that phase begins — it may require an upgrade."*

So the position is:

- **There is no configured continuous archiving.** PITR is deferred and the plan
  tier is unconfirmed.
- With snapshot-only backups at a daily cadence — the common managed default —
  the real RPO is **up to 24 hours**, roughly **288× the target**.
- A data-loss event today would lose every application, payment, message and
  audit row written since the last snapshot.

**This is the single most important open risk from the S8 hardening sprint.**
The restore mechanism is sound; the retention policy in front of it is not.

#### What meeting RPO ≤ 5 min requires

1. **Confirm the Railway plan tier** that includes PITR (the action `DEPLOYMENT.md`
   already flags, still open). PITR replays WAL to an arbitrary second and is the
   only mechanism that reaches a 5-minute RPO without hand-rolled archiving.
2. **If PITR is unavailable on the chosen tier**, either upgrade or configure
   continuous WAL archiving to object storage (base backup + `archive_command`
   with `archive_timeout = 60s`).
3. **Snapshots alone cannot meet 5 minutes.** A 5-minute snapshot cadence on a
   database of this size is not viable — this drill's dump took 1.7 s at 14.6 MB,
   but that grows linearly, and every snapshot competes with live traffic.
4. **Re-run this drill against the PITR configuration** and record the measured
   RPO. Until that run exists, the target is unproven regardless of what the plan
   tier claims.

---

## Method

Six steps, executed by `chaos/backup-restore-drill.ts`:

1. **Clone** the dev database (`CREATE DATABASE … TEMPLATE`) so the drill runs
   against realistic volume rather than a toy fixture.
2. **Back up** with `pg_dump -Fc`, recording wall-clock time and size.
3. **Write after the backup** — 5 rows. These are what an RPO measures: with
   snapshot-only backups they are exactly what is lost.
4. **Destroy** — `DROP SCHEMA public CASCADE`. Real and irreversible; the script
   asserts the database is genuinely unusable before proceeding, so a drill that
   silently failed to destroy anything cannot report success.
5. **Restore** — `pg_restore`, then **boot the API against the restored database
   and require it to serve real traffic**. RTO is measured to *service restored*,
   not to "the data is back".
6. **Verify integrity** across tables, financial linkage, the audit trail, the
   GST sequence, and the DB↔object-store relationship.

### Corpus

| Entity | Rows |
|---|---|
| Jobs | 10,015 |
| Applications | 51,207 |
| Candidate profiles | 20,029 |
| Companies | 207 |
| Orders / invoices | 803 / 803 |
| Audit rows | 6,310 |

Dump size **14.6 MB**; backup took **1.7 s**.

---

## Measured timings

| Phase | Duration |
|---|---|
| `pg_dump -Fc` | 1.7 s |
| `pg_restore` (data restored) | 5.1 s |
| API boot + first successful request | ~9 s |
| **Total RTO (incident → serving traffic)** | **14.4 s** |

**Honest caveat on scaling.** 14.4 s reflects a 14.6 MB dump on a local
container with no network transfer. Production restore time scales with data
size and adds download from backup storage. Even a 100× larger dataset with
transfer overhead leaves an enormous margin against the 60-minute target — the
RTO target is not the risk here. **The RPO is.**

---

## Integrity verification (10/10)

| Check | Result |
|---|---|
| Row counts match pre-backup exactly | ✅ all 7 entity counts identical |
| **Referential integrity** — applications→jobs, invoices→orders, jobs→companies | ✅ **0 orphans of any kind** |
| **GST invoice sequence restored ahead of every issued number** | ✅ `seq=810 ≥ maxIssued=803` |
| Audit trail intact | ✅ 6,310 rows |
| Post-backup writes lost (the honest RPO accounting) | ✅ 0/5 survived — as expected, and stated rather than hidden |
| Service serves real traffic off the restored data | ✅ search `200`, health `db: up` |

The invoice-sequence check deserves emphasis: a restored sequence that rewound
behind the issued numbers would **re-issue existing GST invoice numbers**. That
is a legal problem, not a technical one, and it is the kind of thing a
row-count-only verification would miss entirely.

---

## DB ↔ object-store consistency

`pg_dump` captures the database only. R2/MinIO objects are **not** in the dump,
so a restore puts the DB at T1 while object storage remains at T2. Two shapes
follow, and both are real:

| Situation | Consequence |
|---|---|
| DB restored **behind** the object store | Orphaned objects — documents nothing references. Wasted storage; no user-visible breakage. |
| DB restored **ahead of** object deletions | **Dangling keys** — rows pointing at objects that were deleted after T1. A user sees a document that 404s on download. |

The drill confirms document rows retain their `r2Key` references after restore,
so the reconciliation surface is well-defined.

**Required strategy** (recorded in the runbook's restore procedure):

1. **Enable object-store versioning** on the bucket so deletes are recoverable
   and an object can be read as-of a timestamp.
2. **Restore the DB first, then reconcile** — sweep `candidate_documents`,
   `invoices.pdfKey` and `resume_generations.r2Key` for keys whose objects are
   missing, and either restore the object version or null the reference so the
   application degrades honestly rather than serving a broken link.
3. **The purge path is the dangerous direction.** A DB restored to before a DPDP
   erasure would resurrect rows for a user whose objects were destroyed — a
   privacy problem as well as a consistency one. Any restore that crosses a
   purge must re-run the purge for affected users. This is called out explicitly
   in the runbook.

---

## What the drill proves, and what it does not

**Proves:**
- The restore procedure works end-to-end and is executable from the runbook.
- RTO is comfortably inside target, with large headroom for growth.
- Restored data is internally consistent — including the financial and
  compliance invariants that matter most.
- The failure is real: the drill destroys the schema and asserts the destruction
  before restoring.

**Does not prove:**
- **The production RPO.** No continuous archiving is configured; the measured
  figure is the drill's own window. This is the top finding.
- Restore behaviour at production data volume or across a network.
- Object-store recovery — the reconciliation strategy above is designed and
  documented but has **not** been drilled. That is the natural next exercise.
- Restore under pressure by someone other than the author. The runbook exists
  for this; it has not yet been rehearsed by a second person, which is the only
  way to find out whether it is genuinely executable.
