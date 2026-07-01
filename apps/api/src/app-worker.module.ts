import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { CoreModule } from './core/core.module';
import { AuditModule } from './audit/audit.module';
import { NotificationWorkerModule } from './notifications/notification.worker-module';

// Loads: CoreModule (config + Redis) + ScheduleModule (cron runner).
// Must NOT import AppApiModule or any HTTP controllers.
// BullMQ queues and @Cron handlers are added in later sprints.
// Must NOT import AppApiModule or any HTTP controllers.
// BullMQ queues and @Cron handlers are added in later sprints.
@Module({
  imports: [
    CoreModule,
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
    AuditModule,
    NotificationWorkerModule,
  ],
})
export class AppWorkerModule {}
