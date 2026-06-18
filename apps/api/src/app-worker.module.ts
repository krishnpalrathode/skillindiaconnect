import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { CoreModule } from './core/core.module';

// Loads: CoreModule (config + Redis) + ScheduleModule (cron runner).
// Must NOT import AppApiModule or any HTTP controllers.
// BullMQ queues and @Cron handlers are added in later sprints.
@Module({
  imports: [CoreModule, ScheduleModule.forRoot()],
})
export class AppWorkerModule {}
