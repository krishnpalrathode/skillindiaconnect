/**
 * S8-H3 CHAOS — the worker dies mid-flight (crash / OOM-kill).
 *
 * The worker is SHARED: renders, notifications, payment-webhook follow-ups and
 * crons all live in one process. H1 measured that render pressure does not
 * STARVE the others; this proves the harder property — that killing the process
 * outright does not LOSE their work.
 *
 * Injected by SIGKILLing the worker PROCESS ONLY, leaving its Chromium children
 * orphaned. No graceful-shutdown handler runs, so this is an OOM-kill or a hard
 * crash rather than a clean redeploy — and orphaning the children is the point:
 * a tree-kill would reap Chromium on the test's behalf and the zombie check
 * would pass without testing anything.
 *
 * The promises:
 *  1. DURABILITY — jobs in flight at the moment of death are not lost. BullMQ
 *     redelivers them to the next worker.
 *  2. A RENDER CRASH LOSES NO PAYMENT ACTIVATION — the queue is the system of
 *     record, and a notification queued before the crash still gets processed.
 *  3. NO CHROMIUM ZOMBIES — a killed worker must not leave orphaned browser
 *     processes behind to eat the box.
 *  4. IDEMPOTENCY ACROSS CRASH-RESTART — the subtle one. Activation
 *     (FOR UPDATE + state re-check), the webhook (provider,eventId) dedupe and
 *     the purge resume marker must all hold across a PROCESS RESTART, not just
 *     across concurrent delivery. A worker that dies mid-activation and comes
 *     back must not double-activate, double-invoice or double-notify.
 *
 *   pnpm chaos:worker
 */
import { createHmac, randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';
import {
  OrderStatus,
  PrismaClient,
  ResumeGenerationStatus,
  ResumeTrigger,
} from '@prisma/client';
import { Queue } from 'bullmq';
import {
  ChaosRecorder,
  finish,
  req,
  sleep,
  startApi,
  startWorker,
  waitFor,
} from './lib/harness';
import { build, makeOrder, purge } from './lib/fixtures';

const PORT = Number(process.env.CHAOS_API_PORT ?? 3304);
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const prisma = new PrismaClient();

/**
 * Count ONLY Puppeteer-launched Chromium.
 *
 * Counting every `chrome.exe` is useless on a developer machine: the operator's
 * own browser contributes dozens of processes that drift on their own, which
 * swamps the signal and yields both false alarms and false all-clears (an early
 * version of this check read ~35 baseline processes and was pure noise).
 * Puppeteer runs the browser it downloaded into its own cache directory, so the
 * EXECUTABLE PATH isolates exactly the processes this scenario is responsible
 * for. Command-line flags were tried first and are not reliable here.
 */
function chromeCount(): number {
  try {
    if (process.platform === 'win32') {
      // Discriminate on the EXECUTABLE PATH, not on flags. Puppeteer runs the
      // browser it downloaded into its own cache directory
      // (~/.cache/puppeteer/chrome/...), which the operator's installed Chrome
      // never matches. Command-line flags proved unreliable: the user's browser
      // also spawns `--user-data-dir=` children, and new-headless Chrome does
      // not always carry a plain `--headless`.
      // NOTE: only SINGLE quotes inside the PowerShell snippet. The command is
      // itself wrapped in double quotes for the shell, so a nested double quote
      // (e.g. -Filter "Name='chrome.exe'") silently terminates the outer string
      // and the whole thing evaluates to nothing — which reads as "zero
      // zombies" and would make this check pass for the wrong reason.
      const ps =
        "(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'chrome.exe' -and " +
        "$_.ExecutablePath -like '*puppeteer*' } | Measure-Object).Count";
      const out = execSync(`powershell -NoProfile -Command "${ps}"`, { encoding: 'utf8' });
      return Number(out.trim()) || 0;
    }
    const out = execSync("ps -eo args | grep -c -- '[.]cache/puppeteer' || true", { encoding: 'utf8' });
    return Number(out.trim()) || 0;
  } catch {
    return 0;
  }
}

function envelope(orderId: string) {
  return {
    entity: 'event',
    event: 'payment.captured',
    contains: ['payment'],
    payload: {
      payment: {
        entity: {
          id: `pay_${randomUUID().replace(/-/g, '').slice(0, 14)}`,
          entity: 'payment',
          status: 'captured',
          notes: { orderId },
        },
      },
    },
  };
}

async function main() {
  console.log('S8-H3 CHAOS — worker crash / OOM-kill mid-flight\n');
  const fx = await build(prisma);
  const rec = new ChaosRecorder();

  const resumeQueue = new Queue('resume-render', { connection: { url: REDIS_URL } });
  const notificationQueue = new Queue('notification', { connection: { url: REDIS_URL } });
  const api = await startApi(PORT, { RATE_LIMIT_GLOBAL_PER_MIN: '1000000' });

  try {
    const chromeBefore = chromeCount();

    // ── Set up work that is IN FLIGHT when the worker dies ─────────────────
    const resume = await prisma.candidateResume.upsert({
      where: { candidateId: fx.waCandidateId },
      create: { candidateId: fx.waCandidateId },
      update: {},
    });
    const generations: string[] = [];
    for (let i = 0; i < 6; i++) {
      const g = await prisma.resumeGeneration.create({
        data: {
          resumeId: resume.id,
          status: ResumeGenerationStatus.PENDING,
          trigger: ResumeTrigger.DOWNLOAD,
          settingsSnapshot: {
            language: 'en',
            showPhone: true,
            showReligion: false,
            showFatherName: true,
            showPassportNumber: false,
          },
        },
      });
      generations.push(g.id);
    }

    const worker1 = await startWorker({ RENDER_POOL_CONCURRENCY: '2', RESUME_RENDER_CONCURRENCY: '2' });

    await resumeQueue.addBulk(
      generations.map((id) => ({
        name: 'generate-resume',
        data: { generationId: id, candidateId: fx.waCandidateId },
        opts: { jobId: `chaos-render-${id}`, attempts: 3, backoff: { type: 'fixed' as const, delay: 2000 } },
      })),
    );

    // A notification queued BEFORE the crash — it stands in for any non-render
    // consumer's work (the blast-radius question).
    const emailsBefore = await prisma.emailMessage.count({ where: { userId: fx.candidateUserId } });
    await notificationQueue.add(
      'send-notification',
      {
        userId: fx.candidateUserId,
        type: 'SUBSCRIPTION_PURCHASED',
        channel: 'email',
        payload: { title: 'Queued before the crash', body: 'Must survive the worker dying.', data: {} },
      },
      { jobId: `chaos-notif-${randomUUID()}` },
    );

    // Wait until Chromium is genuinely rendering, then kill without warning.
    await waitFor(
      async () => worker1.logs.some((l) => l.includes('chromium launched')),
      90_000,
      'Chromium to launch (so the kill lands mid-render)',
    );
    await sleep(1200);

    const chromeDuring = chromeCount();
    console.log(`── injecting: SIGKILL the worker ONLY, mid-render (chrome procs: ${chromeDuring}) ──`);
    // killSelfOnly, NOT kill: an OOM-killer takes one process and leaves its
    // children orphaned. A tree-kill would reap Chromium for us and the zombie
    // check below would pass while proving nothing.
    worker1.killSelfOnly();
    await sleep(3000);

    rec.check({
      id: 'worker-actually-killed',
      scenario: 'Worker crash',
      promise: 'Control: the worker really was killed mid-render (otherwise nothing below is meaningful)',
      injected: 'SIGKILL of the worker process only, during an active Chromium render',
      expected: 'process exited, and Chromium had been running',
      observed: `exited=${worker1.exited()} chromeDuringRender=${chromeDuring}`,
      pass: worker1.exited() && chromeDuring > chromeBefore,
      severity: 'Info',
    });

    // ── 3. No Chromium zombies ─────────────────────────────────────────────
    await sleep(4000);
    const chromeAfterKill = chromeCount();
    rec.check({
      id: 'worker-no-chromium-zombies',
      scenario: 'Worker crash',
      promise:
        'An OOM-killed worker leaves NO orphaned Chromium processes — its children must not survive it and accumulate',
      injected: 'SIGKILL of the worker PROCESS ONLY, orphaning its Chromium children (no shutdown hook ran)',
      expected: `chrome process count back to ~baseline (${chromeBefore})`,
      observed: `${chromeAfterKill} chrome processes after the kill`,
      pass: chromeAfterKill <= chromeBefore,
      severity: 'High',
      detail: { chromeBefore, chromeDuring, chromeAfterKill },
    });

    // ── 1 + 2. Restart: the queue must still hold the work ─────────────────
    console.log('── restarting the worker ──');
    const worker2 = await startWorker({ RENDER_POOL_CONCURRENCY: '2', RESUME_RENDER_CONCURRENCY: '2' });

    try {
      let renderedOk = 0;
      try {
        await waitFor(
          async () => {
            renderedOk = await prisma.resumeGeneration.count({
              where: { id: { in: generations }, status: ResumeGenerationStatus.READY },
            });
            const settled = await prisma.resumeGeneration.count({
              where: { id: { in: generations }, status: { not: ResumeGenerationStatus.PENDING } },
            });
            return settled === generations.length;
          },
          240_000,
          'the redelivered render jobs to settle',
        );
      } catch {
        /* recorded below */
      }

      rec.check({
        id: 'worker-renders-redelivered',
        scenario: 'Worker crash',
        promise: 'DURABILITY — render jobs in flight at the crash are redelivered to the next worker, not lost',
        injected: 'SIGKILL mid-render, then restart',
        expected: `all ${generations.length} generations reach a terminal state, most of them READY`,
        observed: `${renderedOk}/${generations.length} READY`,
        pass: renderedOk >= generations.length - 1,
        severity: 'High',
      });

      let notified = false;
      try {
        await waitFor(
          async () => {
            notified =
              (await prisma.emailMessage.count({ where: { userId: fx.candidateUserId } })) > emailsBefore;
            return notified;
          },
          90_000,
          'the pre-crash notification to be processed after restart',
        );
      } catch {
        /* recorded below */
      }
      rec.check({
        id: 'worker-notification-survives-render-crash',
        scenario: 'Worker crash',
        promise: "H1's blast radius under a real crash — a render crash does not LOSE another consumer's queued work",
        injected: 'SIGKILL during renders, with a notification already queued',
        expected: 'the notification is delivered after the restart',
        observed: notified ? 'delivered after restart' : 'NEVER delivered',
        pass: notified,
        severity: 'Critical',
      });

      // ── 4. IDEMPOTENCY ACROSS CRASH-RESTART ──────────────────────────────
      // A signed webhook activates an order; the worker is then killed and
      // restarted, and the SAME event is redelivered. Exactly one activation
      // must exist — the dedupe and state re-check must survive a process
      // restart, not merely concurrent delivery.
      const orderId = await makeOrder(prisma, fx);
      const raw = Buffer.from(JSON.stringify(envelope(orderId)), 'utf8');
      const sig = createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET!).update(raw).digest('hex');
      const eventId = `evt_${randomUUID()}`;
      const headers = {
        'content-type': 'application/json',
        'x-razorpay-signature': sig,
        'x-razorpay-event-id': eventId,
      };

      const first = await fetch(`${api.base}/api/v1/webhooks/razorpay`, { method: 'POST', headers, body: raw });
      const afterFirst = await prisma.invoice.count({ where: { orderId } });

      console.log('── injecting: SIGKILL the worker, then redeliver the SAME webhook ──');
      worker2.killSelfOnly();
      await sleep(2500);
      const worker3 = await startWorker({ RENDER_POOL_CONCURRENCY: '1', RESUME_RENDER_CONCURRENCY: '1' });

      try {
        const replay = await fetch(`${api.base}/api/v1/webhooks/razorpay`, { method: 'POST', headers, body: raw });
        await sleep(3000);

        const [invoices, subs, payments, order] = await Promise.all([
          prisma.invoice.count({ where: { orderId } }),
          prisma.subscription.count({ where: { orderId } }),
          prisma.payment.count({ where: { orderId } }),
          prisma.order.findUnique({ where: { id: orderId }, select: { status: true } }),
        ]);

        rec.check({
          id: 'idempotency-across-crash-restart',
          scenario: 'Worker crash',
          promise:
            'IDEMPOTENCY SURVIVES A PROCESS RESTART — redelivering the same event after a crash does not double-activate, double-invoice or double-charge',
          injected: 'signed webhook → SIGKILL the worker → restart → redeliver the identical event',
          expected: 'order PAID, exactly 1 invoice, 1 subscription, 1 payment row',
          observed: `first=${first.status} replay=${replay.status} order=${order?.status} invoices=${invoices} subs=${subs} payments=${payments}`,
          pass:
            replay.status === 200 &&
            order?.status === OrderStatus.PAID &&
            invoices === 1 &&
            subs === 1 &&
            payments === 1,
          severity: 'Critical',
          detail: { invoicesAfterFirstDelivery: afterFirst },
        });

        // The invoice NUMBER must also be single — a second number would burn a
        // GST sequence value and imply a second legal document.
        const numbers = await prisma.invoice.findMany({ where: { orderId }, select: { number: true } });
        rec.check({
          id: 'idempotency-single-invoice-number',
          scenario: 'Worker crash',
          promise: 'Exactly ONE GST invoice number is issued per order across a crash-restart',
          injected: 'crash + redelivery',
          expected: '1 invoice number',
          observed: numbers.map((n) => n.number).join(', ') || 'none',
          pass: numbers.length === 1,
          severity: 'Critical',
        });
      } finally {
        await worker3.stop();
      }
    } finally {
      if (!worker2.exited()) await worker2.stop();
    }

    // ── Final zombie sweep ────────────────────────────────────────────────
    await sleep(4000);
    const chromeFinal = chromeCount();
    rec.check({
      id: 'worker-no-zombies-after-all-restarts',
      scenario: 'Worker crash',
      promise: 'After repeated crash/restart cycles, no Chromium processes are left behind',
      injected: 'two SIGKILLs and two restarts',
      expected: `chrome count back to ~baseline (${chromeBefore})`,
      observed: String(chromeFinal),
      pass: chromeFinal <= chromeBefore,
      severity: 'High',
    });
  } finally {
    await api.stop();
    await resumeQueue.close();
    await notificationQueue.close();
    if (process.env.CHAOS_KEEP_FIXTURES !== '1') await purge(prisma);
    await prisma.$disconnect();
  }

  finish(rec, 'worker-crash.json');
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exitCode = 1;
});
