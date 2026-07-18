/**
 * S7-B1 — the invoice-PDF debt closer, proven: a REAL Chromium render whose
 * extracted text carries the invoice number, GST split and total (from the
 * stored subunits); idempotent skip of already-rendered rows; the backfill
 * sweep's per-day deduped enqueues; and the activation's post-commit enqueue.
 */
import { PDFParse } from 'pdf-parse';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Queue } from 'bullmq';
import { PrismaService } from '../core/prisma/prisma.service';
import { StorageService } from '../core/storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { EmployerService } from '../employer/employer.service';
import { NotificationService } from '../notifications/notification.service';
import { BrowserPoolService } from '../pdf/browser-pool.service';
import { PdfRenderService } from '../pdf/pdf-render.service';
import { InvoiceRenderService } from './invoice-render.service';
import { InvoiceRenderProcessor } from './invoice-render.processor';
import { InvoiceService } from './invoice.service';
import { ActivationService } from './activation.service';
import { JOB_NAMES } from '../queue/queue.constants';

jest.setTimeout(120_000);

let pool: BrowserPoolService;
beforeAll(() => {
  pool = new BrowserPoolService({ get: () => undefined } as unknown as ConfigService);
});
afterAll(async () => {
  await pool.onModuleDestroy();
});

const invoiceRow = {
  id: 'inv-1',
  number: 'SIC-2026-00042',
  pdfKey: null as string | null,
  issuedAt: new Date('2026-07-01T10:00:00Z'),
  order: {
    currency: 'INR',
    amountSubunits: 296_525,
    gstSubunits: 53_374,
    totalSubunits: 349_899,
    company: { name: 'Sharma Builders Pvt Ltd', location: 'Mumbai, India' },
    plan: { name: 'Pro Monthly' },
  },
};

function buildRenderService() {
  const prisma = {
    invoice: {
      findUnique: jest.fn().mockResolvedValue({ ...invoiceRow }),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const storage = { putObject: jest.fn().mockResolvedValue(undefined) };
  const pdfRender = new PdfRenderService(pool, storage as unknown as StorageService);
  const service = new InvoiceRenderService(prisma as unknown as PrismaService, pdfRender);
  return { service, prisma, storage };
}

describe('InvoiceRenderService', () => {
  it('renders a valid GST invoice PDF — number, GST split and total in the extracted text', async () => {
    const { service, prisma, storage } = buildRenderService();
    const { pdfKey, skipped } = await service.renderInvoice('inv-1');

    expect(skipped).toBe(false);
    expect(pdfKey.startsWith('invoices/inv-1/')).toBe(true);

    const buffer = (storage.putObject as jest.Mock).mock.calls[0][1] as Buffer;
    expect(buffer.subarray(0, 5).toString('utf8')).toBe('%PDF-');
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    const text = (await parser.getText()).text;
    await parser.destroy();
    expect(text).toContain('SIC-2026-00042');
    expect(text).toContain('TAX INVOICE');
    expect(text).toContain('Sharma Builders Pvt Ltd');
    expect(text).toContain('Pro Monthly');
    // Amounts formatted FROM the stored subunits — never recomputed.
    expect(text).toContain('INR 2965.25'); // subtotal
    expect(text).toContain('INR 533.74'); // GST
    expect(text).toContain('INR 3498.99'); // total

    // The pdfKey lands with a null-guard (write-once for a financial artifact).
    expect(prisma.invoice.updateMany).toHaveBeenCalledWith({
      where: { id: 'inv-1', pdfKey: null },
      data: { pdfKey },
    });
  });

  it('IDEMPOTENT: an already-rendered invoice is skipped — no render, no write', async () => {
    const { service, prisma, storage } = buildRenderService();
    (prisma.invoice.findUnique as jest.Mock).mockResolvedValue({
      ...invoiceRow,
      pdfKey: 'invoices/inv-1/existing.pdf',
    });
    const { pdfKey, skipped } = await service.renderInvoice('inv-1');
    expect(skipped).toBe(true);
    expect(pdfKey).toBe('invoices/inv-1/existing.pdf');
    expect(storage.putObject).not.toHaveBeenCalled();
    expect(prisma.invoice.updateMany).not.toHaveBeenCalled();
  });
});

describe('the backfill sweep', () => {
  it('enqueues one deduped, day-suffixed job per null-pdfKey invoice; a clean run enqueues none', async () => {
    const renderService = {
      findUnrendered: jest.fn().mockResolvedValueOnce(['inv-a', 'inv-b']).mockResolvedValueOnce([]),
      renderInvoice: jest.fn(),
    } as unknown as InvoiceRenderService;
    const audit = { log: jest.fn() } as unknown as AuditService;
    const add = jest.fn().mockResolvedValue(undefined);
    const processor = new InvoiceRenderProcessor(renderService, audit, {
      add,
    } as unknown as Queue);

    const first = await processor.process({ name: JOB_NAMES.INVOICE_BACKFILL_SWEEP } as never);
    expect(first).toEqual({ enqueued: 2 });
    const day = new Date().toISOString().slice(0, 10);
    expect(add).toHaveBeenCalledWith(
      JOB_NAMES.RENDER_INVOICE,
      { invoiceId: 'inv-a' },
      expect.objectContaining({ jobId: `render-invoice-inv-a-${day}` }),
    );

    // Second run: everything already rendered → nothing enqueued (idempotent).
    add.mockClear();
    const second = await processor.process({ name: JOB_NAMES.INVOICE_BACKFILL_SWEEP } as never);
    expect(second).toEqual({ enqueued: 0 });
    expect(add).not.toHaveBeenCalled();
  });
});

describe('activation enqueues the render post-commit (the S5-B2 edit)', () => {
  it('a committed activation adds a render-invoice job with the deterministic jobId', async () => {
    const committed = {
      payload: {
        orderId: 'ord-1',
        companyId: 'co-1',
        planId: 'pl-1',
        subscriptionId: 'sub-1',
        invoiceId: 'inv-9',
      },
      invoiceNumber: 'SIC-2026-00099',
      planName: 'Pro Monthly',
    };
    // $transaction is mocked to "commit" directly — the unit under test is the
    // POST-commit side effect, not the transaction body.
    const prisma = { $transaction: jest.fn().mockResolvedValue(committed) };
    const add = jest.fn().mockResolvedValue(undefined);
    const activation = new ActivationService(
      prisma as unknown as PrismaService,
      new InvoiceService(),
      {
        getPrimaryUserIdForCompany: jest.fn().mockResolvedValue(null),
      } as unknown as EmployerService,
      { notify: jest.fn() } as unknown as NotificationService,
      { log: jest.fn(), logInTransaction: jest.fn() } as unknown as AuditService,
      new EventEmitter2(),
      { add } as unknown as Queue,
    );

    const result = await activation.activate('ord-1', {
      gatewayPaymentId: 'pay_x',
      rawPayload: {},
    });

    expect(result.activated).toBe(true);
    expect(add).toHaveBeenCalledWith(
      JOB_NAMES.RENDER_INVOICE,
      { invoiceId: 'inv-9' },
      { jobId: 'render-invoice-inv-9' },
    );
  });
});
