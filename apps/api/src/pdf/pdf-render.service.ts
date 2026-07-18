import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { StorageService } from '../core/storage/storage.service';
import { BrowserPoolService } from './browser-pool.service';

export interface RenderToR2Result {
  r2Key: string;
  sizeBytes: number;
  /** sha256 of the PDF bytes — the generation record's contentHash. */
  contentHash: string;
}

/**
 * THE generic renderer (S7-B1): html → PDF buffer (via the bounded pool) →
 * R2. This ONE service serves BOTH resume and invoice rendering — a second
 * renderer is the anti-goal; callers differ only in the HTML they supply and
 * the key prefix they own.
 *
 * Worker-only by construction: it depends on BrowserPoolService, so importing
 * it into the API process would drag Chromium along — the structural test
 * asserts that never happens.
 */
@Injectable()
export class PdfRenderService {
  private readonly logger = new Logger(PdfRenderService.name);

  constructor(
    private readonly pool: BrowserPoolService,
    private readonly storage: StorageService,
  ) {}

  async renderToR2(
    html: string,
    opts: { keyPrefix: string; filename: string },
  ): Promise<RenderToR2Result> {
    const buffer = await this.pool.render(html);
    const contentHash = createHash('sha256').update(buffer).digest('hex');
    // Scoped, collision-free key: the caller owns the prefix, we add the hash
    // so re-renders of identical content are self-deduplicating keys.
    const r2Key = `${opts.keyPrefix}/${contentHash.slice(0, 16)}-${opts.filename}`;
    await this.storage.putObject(r2Key, buffer, 'application/pdf');
    // Size + duration are loggable; content never is (PII).
    this.logger.log(`rendered ${buffer.length} bytes → ${opts.keyPrefix}/…`);
    return { r2Key, sizeBytes: buffer.length, contentHash };
  }
}
