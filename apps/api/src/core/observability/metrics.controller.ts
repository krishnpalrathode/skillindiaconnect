/**
 * S8-H3 — GET /metrics, Prometheus text exposition.
 *
 * VERSION_NEUTRAL and outside the /api/v1 prefix, alongside the health probes:
 * a scraper's target URL should not move when the business API is versioned.
 *
 * ACCESS: `@Public()` because scrapers do not carry bearer tokens, and the
 * endpoint exposes only aggregate counters — no identifiers, no payloads, no
 * PII (route labels are path TEMPLATES, never concrete ids). It should still be
 * kept off the public internet at the network layer; that is stated in the
 * runbook because it is a deployment concern, not a code one.
 */
import { Controller, Get, Header, VERSION_NEUTRAL } from '@nestjs/common';
import { Public } from '../../auth/decorators/public.decorator';
import { MetricsService } from './metrics.service';
import { RuntimeMetricsService } from './runtime-metrics.service';

@Public()
@Controller({ path: 'metrics', version: VERSION_NEUTRAL })
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly runtime: RuntimeMetricsService,
  ) {}

  @Get()
  @Header('content-type', 'text/plain; version=0.0.4; charset=utf-8')
  async scrape(): Promise<string> {
    // Refresh the cheap in-process gauges on scrape so memory/uptime are exact
    // at read time. Queue gauges are NOT refreshed here — they touch Redis, and
    // the scrape must answer even when Redis is down (their timer keeps them
    // current, and a stale queue gauge during an outage is preferable to a
    // metrics endpoint that hangs).
    this.runtime.collectProcessOnly();
    return this.metrics.render();
  }
}
