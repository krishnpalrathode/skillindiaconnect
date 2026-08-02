import { Module } from '@nestjs/common';
import { QueueModule } from '../../queue/queue.module';
import { R2Module } from './r2.module';
import { R2DeleteProcessor } from './r2-delete.processor';

/**
 * Worker-process side of object storage.
 *
 * Exists as a separate module purely so the processor never reaches the API:
 * R2Module is @Global and loaded by AppApiModule, so a @Processor declared
 * there would start a BullMQ consumer inside the API process — the same
 * mistake the notification worker module's docblock warns about.
 *
 * MUST be imported ONLY by AppWorkerModule.
 */
@Module({
  imports: [
    QueueModule, // registers the R2_DELETE queue
    R2Module, // StorageService — own your dependencies, do not rely on @Global
  ],
  providers: [R2DeleteProcessor],
})
export class R2DeleteWorkerModule {}
