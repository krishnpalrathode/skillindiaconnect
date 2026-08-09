import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { NotificationService } from '../notifications/notification.service';
import { InterestNotifyProcessor } from './interest-notify.processor';

/**
 * Worker-process side of the Employer module.
 *
 * Responsibilities:
 * - InterestNotifyProcessor: BullMQ consumer for employer → candidate outreach.
 *   The API writes the interest row and enqueues; the send happens here
 *   (worker-and-external-sends.md).
 *
 * Deliberately does NOT import EmployerModule — that module carries five HTTP
 * controllers, and the worker root must never load controllers. The processor
 * depends only on PrismaService (@Global via CoreModule) and NotificationService,
 * which is provided directly here for the same reason CandidateWorkerModule does.
 *
 * MUST be imported only by AppWorkerModule.
 */
@Module({
  imports: [QueueModule], // registers INTEREST_NOTIFY + NOTIFICATION queues
  providers: [NotificationService, InterestNotifyProcessor],
})
export class EmployerWorkerModule {}
