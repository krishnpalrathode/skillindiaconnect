import { Module } from '@nestjs/common';
import { BrowserPoolService } from './browser-pool.service';
import { PdfRenderService } from './pdf-render.service';

/**
 * WORKER-ONLY module (S7-B1). Imported by AppWorkerModule and NEVER by
 * AppApiModule — Chromium runs only in the worker process
 * (worker-and-external-sends.md). The API enqueues render jobs; it must not
 * even transitively load puppeteer. A structural spec walks the API module
 * graph to keep this true.
 */
@Module({
  providers: [BrowserPoolService, PdfRenderService],
  exports: [PdfRenderService, BrowserPoolService],
})
export class PdfModule {}
