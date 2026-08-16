import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { R2Module } from '../core/storage/r2.module';
import { ChannelsModule } from './channels/channels.module';
import { NotificationProcessor } from './notification.processor';

/**
 * Worker-process side of the Notifications module.
 *
 * Responsibilities:
 * - NotificationProcessor: the first real BullMQ consumer in the codebase.
 *   Handles QUEUE_NAMES.NOTIFICATION jobs — calls WhatsApp/email channels,
 *   records whatsapp_messages / email_messages, audits outcomes.
 *
 * This module MUST be imported ONLY by AppWorkerModule — never by AppApiModule.
 * Importing it in the API process would start a BullMQ worker in-process,
 * causing duplicate external sends.
 *
 * AuditModule is @Global() and available in the worker process without an explicit import.
 * CoreModule (PrismaService) is @Global() and available without an explicit import.
 */
@Module({
  imports: [
    QueueModule, // BullMQ connection + NOTIFICATION queue registration
    // StorageService, for resolving a document-template's R2 key to bytes at
    // send time. R2Module is @Global, but imported explicitly: this module must
    // not depend on ANOTHER worker module happening to import it (the
    // CandidateWorkerModule precedent — own your dependencies).
    R2Module,
    ChannelsModule, // WHATSAPP_CHANNEL + EMAIL_CHANNEL bindings
  ],
  providers: [NotificationProcessor],
})
export class NotificationWorkerModule {}
