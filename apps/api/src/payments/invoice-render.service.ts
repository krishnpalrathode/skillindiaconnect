import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../core/prisma/prisma.service';
import { PdfRenderService } from '../pdf/pdf-render.service';
import { renderInvoiceHtml } from './templates/invoice.template';

/**
 * Invoice PDF rendering (S7-B1, WORKER-ONLY) — the S5-B2 debt closer. Uses
 * THE SAME PdfRenderService as the resume (one renderer, no duplication);
 * only the HTML and the key prefix differ.
 *
 * Idempotent: an invoice whose pdfKey is already set is skipped — the daily
 * backfill sweep re-enqueues null-pdfKey rows without ever double-rendering.
 */
@Injectable()
export class InvoiceRenderService {
  private readonly logger = new Logger(InvoiceRenderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pdfRender: PdfRenderService,
  ) {}

  /** Render invoice `invoiceId` and populate its pdfKey. Skips when already rendered. */
  async renderInvoice(invoiceId: string): Promise<{ pdfKey: string; skipped: boolean }> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        order: { include: { company: { select: { name: true, location: true } }, plan: true } },
      },
    });
    if (!invoice) throw new Error(`invoice not found: ${invoiceId}`);
    if (invoice.pdfKey) return { pdfKey: invoice.pdfKey, skipped: true };

    const html = renderInvoiceHtml({
      number: invoice.number,
      issuedAt: invoice.issuedAt,
      companyName: invoice.order.company.name,
      companyLocation: invoice.order.company.location,
      planName: invoice.order.plan.name,
      currency: invoice.order.currency,
      amountSubunits: invoice.order.amountSubunits,
      gstSubunits: invoice.order.gstSubunits,
      totalSubunits: invoice.order.totalSubunits,
    });

    const { r2Key } = await this.pdfRender.renderToR2(html, {
      keyPrefix: `invoices/${invoice.id}`,
      filename: `${invoice.number}.pdf`,
    });

    // Guarded update: if a concurrent render won the race, keep ITS key —
    // financial artifacts are written once.
    const updated = await this.prisma.invoice.updateMany({
      where: { id: invoiceId, pdfKey: null },
      data: { pdfKey: r2Key },
    });
    if (updated.count === 0) {
      this.logger.log(`invoice ${invoice.number}: pdfKey already set by a concurrent render`);
    }
    return { pdfKey: r2Key, skipped: false };
  }

  /** Ids of invoices still awaiting a PDF (the backfill sweep's worklist). */
  async findUnrendered(limit = 500): Promise<string[]> {
    const rows = await this.prisma.invoice.findMany({
      where: { pdfKey: null },
      select: { id: true },
      orderBy: { issuedAt: 'asc' },
      take: limit,
    });
    return rows.map((r) => r.id);
  }
}
