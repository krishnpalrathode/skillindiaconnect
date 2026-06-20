# Cron → Queue dedupe (HARD RULE)

`@nestjs/schedule` cron handlers run IN-PROCESS. If the worker ever runs more than
one replica, every `@Cron` fires on every replica — duplicate passport reminders,
double auto-archiving, double subscription pauses.

**Rule:** a cron handler does NOTHING but enqueue a BullMQ job with a
**deterministic `jobId`** derived from the logical window. It never does DB writes
or external sends inline. BullMQ's jobId dedupe then makes execution exactly-once
regardless of replica count.

```ts
@Cron('0 2 * * *')
async scheduleAutoArchive() {
  const day = new Date().toISOString().slice(0, 10); // 2026-06-20
  await this.queue.add('auto-archive', {}, { jobId: `auto-archive:${day}` });
}
```

The actual archiving happens in the BullMQ processor, not the cron method.

**Anti-pattern (forbidden):** querying/writing the DB or sending WhatsApp/email
directly inside the `@Cron` method.

Applies to: auto-archive (90d), passport-expiry reminders, subscription
expiry/grace transitions, and every future scheduled task.
