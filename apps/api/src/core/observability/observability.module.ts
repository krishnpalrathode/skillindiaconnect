/**
 * S8-H3 — the observability module: metrics registry, the HTTP metrics
 * interceptor, the /metrics endpoint, and the runtime/queue collectors.
 *
 * Global so any module can inject MetricsService without re-importing.
 */
import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { MetricsService } from './metrics.service';
import { MetricsController } from './metrics.controller';
import { HttpMetricsInterceptor } from './http-metrics.interceptor';
import { RuntimeMetricsService } from './runtime-metrics.service';

@Global()
@Module({
  controllers: [MetricsController],
  providers: [
    MetricsService,
    RuntimeMetricsService,
    { provide: APP_INTERCEPTOR, useClass: HttpMetricsInterceptor },
  ],
  exports: [MetricsService, RuntimeMetricsService],
})
export class ObservabilityModule {}
