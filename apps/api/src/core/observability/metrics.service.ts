/**
 * S8-H3 — the metrics registry, exposed in Prometheus text format.
 *
 * Deliberately dependency-free. `prom-client` would be the default choice, but
 * the metric set here is small and fixed, the exposition format is a handful of
 * lines, and every dependency added to a service that handles payments is a
 * supply-chain decision (H2's SCA already carries 52 advisories). If the metric
 * set grows beyond this, swapping in prom-client is a contained change: the
 * shape below is deliberately the same.
 *
 * WHAT IS MEASURED, and why — every one of these traces to a finding:
 *
 *  - worker RSS + Chromium pool state → H1 measured a ~515-680MB peak at pool
 *    cap 2 against a 1GB budget, and an OOM there takes payments and
 *    notifications down with it. This is the metric that lets the alert fire
 *    BEFORE the kill rather than after.
 *  - per-queue depth and processing lag → H1's blast-radius question made
 *    continuously visible: if renders start starving other consumers, the
 *    notification/webhook queues back up and it shows here.
 *  - DB pool utilisation → H1 flagged exhaustion as a failure that looks like
 *    an application bug.
 *  - auth failures and rate-limit hits → H2's brute-force concern, made
 *    observable; a spike is an attack in progress.
 *  - payment activation outcomes → the money path, where a silent failure is
 *    the most expensive kind.
 */
import { Injectable } from '@nestjs/common';

type Labels = Record<string, string>;

interface Series {
  name: string;
  help: string;
  type: 'counter' | 'gauge' | 'histogram';
  values: Map<string, { labels: Labels; value: number }>;
  buckets?: number[];
  /** histogram only: label-key → bucket counts + sum/count */
  hist?: Map<string, { labels: Labels; counts: number[]; sum: number; count: number }>;
}

const LATENCY_BUCKETS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

function labelKey(labels: Labels): string {
  return Object.keys(labels)
    .sort()
    .map((k) => `${k}="${labels[k]}"`)
    .join(',');
}

@Injectable()
export class MetricsService {
  private readonly series = new Map<string, Series>();

  private ensure(name: string, help: string, type: Series['type'], buckets?: number[]): Series {
    let s = this.series.get(name);
    if (!s) {
      s = { name, help, type, values: new Map(), buckets, hist: type === 'histogram' ? new Map() : undefined };
      this.series.set(name, s);
    }
    return s;
  }

  increment(name: string, help: string, labels: Labels = {}, by = 1): void {
    const s = this.ensure(name, help, 'counter');
    const key = labelKey(labels);
    const cur = s.values.get(key);
    if (cur) cur.value += by;
    else s.values.set(key, { labels, value: by });
  }

  setGauge(name: string, help: string, value: number, labels: Labels = {}): void {
    const s = this.ensure(name, help, 'gauge');
    s.values.set(labelKey(labels), { labels, value });
  }

  observe(name: string, help: string, valueMs: number, labels: Labels = {}): void {
    const s = this.ensure(name, help, 'histogram', LATENCY_BUCKETS_MS);
    const key = labelKey(labels);
    let h = s.hist!.get(key);
    if (!h) {
      h = { labels, counts: new Array(LATENCY_BUCKETS_MS.length).fill(0), sum: 0, count: 0 };
      s.hist!.set(key, h);
    }
    h.sum += valueMs;
    h.count += 1;
    for (let i = 0; i < LATENCY_BUCKETS_MS.length; i++) {
      if (valueMs <= LATENCY_BUCKETS_MS[i]!) h.counts[i]! += 1;
    }
  }

  /** Prometheus text exposition (v0.0.4). */
  render(): string {
    const lines: string[] = [];
    for (const s of this.series.values()) {
      lines.push(`# HELP ${s.name} ${s.help}`);
      lines.push(`# TYPE ${s.name} ${s.type}`);

      if (s.type === 'histogram') {
        for (const h of s.hist!.values()) {
          const base = labelKey(h.labels);
          let cumulative = 0;
          for (let i = 0; i < s.buckets!.length; i++) {
            cumulative = h.counts[i]!;
            const le = `le="${s.buckets![i]}"`;
            lines.push(`${s.name}_bucket{${base ? base + ',' : ''}${le}} ${cumulative}`);
          }
          lines.push(`${s.name}_bucket{${base ? base + ',' : ''}le="+Inf"} ${h.count}`);
          lines.push(`${s.name}_sum{${base}} ${h.sum}`);
          lines.push(`${s.name}_count{${base}} ${h.count}`);
        }
      } else {
        for (const v of s.values.values()) {
          const base = labelKey(v.labels);
          lines.push(`${s.name}${base ? `{${base}}` : ''} ${v.value}`);
        }
      }
    }
    return lines.join('\n') + '\n';
  }

  // ── Named helpers, so call sites cannot drift on metric names ────────────

  recordHttpRequest(method: string, route: string, status: number, ms: number): void {
    this.increment('sic_http_requests_total', 'HTTP requests handled', {
      method,
      route,
      status: String(status),
    });
    this.observe('sic_http_request_duration_ms', 'HTTP request duration in milliseconds', ms, {
      method,
      route,
    });
    if (status >= 500) {
      this.increment('sic_http_server_errors_total', 'HTTP 5xx responses', { route });
    }
  }

  recordAuthFailure(reason: string): void {
    this.increment('sic_auth_failures_total', 'Failed authentication attempts', { reason });
  }

  recordRateLimitHit(route: string): void {
    this.increment('sic_rate_limit_hits_total', 'Requests rejected by the rate limiter', { route });
  }

  recordActivation(outcome: 'activated' | 'noop' | 'failed'): void {
    this.increment('sic_payment_activations_total', 'Subscription activation outcomes', { outcome });
  }

  recordWebhook(provider: string, outcome: string, ms: number): void {
    this.increment('sic_webhook_events_total', 'Webhook events processed', { provider, outcome });
    this.observe('sic_webhook_processing_ms', 'Webhook processing duration in milliseconds', ms, {
      provider,
    });
  }

  /**
   * A WhatsApp send ATTEMPT and how it ended (CR-WA).
   *
   * `kind` is the WaMessageKind (`OTP`, `STATUS_UPDATE`, `RESUME_DOCUMENT`), which
   * is what lets the alerting split login availability from notification delivery.
   * An OTP failure is a user who cannot log in; a STATUS_UPDATE failure degrades
   * to email. Those deserve different severities, and one counter without this
   * label could not express that.
   *
   * ⚠️ `downgraded` is NOT a failure and MUST stay out of any failure ratio. It
   * is a user who is not WhatsApp-capable or has opted out — a deliberate
   * decision not to attempt a send. Counting it as failure would make the alert
   * track opt-out rates, fire on nothing, and get muted.
   *
   * ATTEMPTS, NOT LOGICAL SENDS. The notification processor throws on failure so
   * BullMQ retries, and each retry counts again. That is intended: this measures
   * PROVIDER HEALTH, which is what the alert is about.
   */
  recordWhatsappSend(kind: string, outcome: 'sent' | 'failed' | 'downgraded'): void {
    this.increment('sic_whatsapp_sends_total', 'WhatsApp send attempts by kind and outcome', {
      kind,
      outcome,
    });
  }

  /**
   * A delivery status LEARNED FROM META's webhook (CR-WA W2).
   *
   * Deliberately separate from `recordWhatsappSend`: "Meta accepted it" and "it
   * reached the handset" are different facts, and collapsing them would hide the
   * failure mode where every send succeeds and nothing is ever delivered.
   */
  recordWhatsappDeliveryStatus(status: string): void {
    this.increment('sic_whatsapp_delivery_status_total', 'WhatsApp delivery statuses received', {
      status,
    });
  }
}
