import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { R2Module } from '../core/storage/r2.module';
import { PdfModule } from '../pdf/pdf.module';
import { CandidateReadService } from '../candidate/candidate-read.service';
import { NotificationService } from '../notifications/notification.service';
import { ResumeRenderService } from './resume-render.service';
import { ResumeRenderProcessor } from './resume-render.processor';
import { ResumeSubscriber } from './resume.subscriber';

/**
 * Worker-process side of the Resume module (S7-B1) — the module that OWNS
 * candidate_resumes + resume_generations. Profile data flows through
 * CandidateReadService.getResumeSource (Rule 4).
 *
 * MUST be imported only by AppWorkerModule — never by AppApiModule: PdfModule
 * carries Chromium. The S7-B2 API half (endpoints) gets its own api-side
 * module WITHOUT PdfModule.
 */
@Module({
  imports: [QueueModule, R2Module, PdfModule],
  providers: [
    CandidateReadService,
    ResumeRenderService,
    ResumeRenderProcessor,
    // S7-B2: the RESUME_READY notification. Registered HERE because
    // EventEmitter2 is per-process and `resume.generated` is emitted by the
    // processor above — an API-side subscriber would never fire.
    NotificationService,
    ResumeSubscriber,
  ],
})
export class ResumeWorkerModule {}
