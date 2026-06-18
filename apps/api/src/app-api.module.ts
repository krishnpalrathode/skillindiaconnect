import { Module } from '@nestjs/common';
import { CoreModule } from './core/core.module';
import { HealthModule } from './health/health.module';

// Loads: CoreModule (config + Redis) + HealthModule.
// Must NOT import AppWorkerModule or any BullMQ/cron modules.
// All external sends (SMS, email, webhooks) happen in the worker, never here.
@Module({
  imports: [CoreModule, HealthModule],
})
export class AppApiModule {}
