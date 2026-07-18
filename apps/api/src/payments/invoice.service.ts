import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * GST invoice numbering — `SIC-{YYYY}-{NNNNN}` from the Postgres
 * `invoice_number_seq` (hand-edited into migration 0000 precisely for this).
 *
 * `nextval` is called INSIDE the caller's activation transaction:
 *  - the SEQUENCE guarantees uniqueness under concurrent activations of
 *    DIFFERENT orders (nextval never hands two sessions the same number);
 *  - the caller's FOR UPDATE order lock guarantees ONE invoice per order;
 *  - composing in-transaction avoids burning numbers on paths that never
 *    reach the insert. (Postgres sequences are non-transactional by design —
 *    a rolled-back activation still consumes its number, so gaps from
 *    rollbacks are inherent and acceptable; GST rules require uniqueness and
 *    order, not gaplessness under failure.)
 */
@Injectable()
export class InvoiceService {
  /** Compose the next sequential invoice number inside `tx`. */
  async composeNumber(tx: Prisma.TransactionClient): Promise<string> {
    const rows = await tx.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('invoice_number_seq')`;
    const seq = Number(rows[0]!.nextval);
    return `SIC-${new Date().getFullYear()}-${String(seq).padStart(5, '0')}`;
  }

  /**
   * Insert the invoice ROW (the number + linkage land here, transactionally).
   * `pdfKey` stays NULL — PDF rendering deliberately defers to S7's Puppeteer
   * infra (or a fast-follow): the legally-required artifact is the numbered
   * row; the printable document is presentation.
   */
  async createForOrder(tx: Prisma.TransactionClient, orderId: string): Promise<{
    id: string;
    number: string;
  }> {
    const number = await this.composeNumber(tx);
    const invoice = await tx.invoice.create({
      data: { orderId, number, pdfKey: null },
    });
    return { id: invoice.id, number: invoice.number };
  }
}
