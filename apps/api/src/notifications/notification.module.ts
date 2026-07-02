import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { NotificationService } from './notification.service';
import { NotificationSubscriber } from './notification.subscriber';
import { NotificationsController } from './notifications.controller';

/**
 * API-process side of the Notifications module.
 *
 * Responsibilities:
 * - NotificationService.notify(): writes in-app row + enqueues channel jobs.
 * - NotificationsController: candidate feed (GET) + mark-read (POST).
 * - NotificationSubscriber: @OnEvent → notify() for domain events.
 *
 * The processor (BullMQ consumer / actual sends) lives in NotificationWorkerModule
 * and is loaded ONLY in the worker process — never here.
 *
 * NotificationService is exported so other modules (S4 Applications, S2-B4 Employer,
 * S5 Payments) can call notify() directly for intentional notification sends.
 */
@Module({
  imports: [QueueModule],
  controllers: [NotificationsController],
  providers: [NotificationService, NotificationSubscriber],
  exports: [NotificationService],
})
export class NotificationModule {}
