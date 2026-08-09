/**
 * The GST invoice template (S7-B1 — closing S5-B2's deferred pdfKey).
 * Print-oriented A4, fully inline (no network at render time). Amounts arrive
 * as the STORED INTEGER SUBUNITS and are formatted here for display only —
 * the server's stored values are the record; nothing is recomputed.
 */
export interface InvoiceRenderData {
  number: string;
  issuedAt: Date;
  companyName: string;
  companyLocation: string;
  planName: string;
  currency: string;
  amountSubunits: number;
  gstSubunits: number;
  totalSubunits: number;
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function money(subunits: number, currency: string): string {
  const major = (subunits / 100).toFixed(2);
  return `${currency} ${major}`;
}

export function renderInvoiceHtml(data: InvoiceRenderData): string {
  const issued = data.issuedAt.toISOString().slice(0, 10);
  const gstRow =
    data.gstSubunits > 0
      ? `<tr><td>GST</td><td class="num">${esc(money(data.gstSubunits, data.currency))}</td></tr>`
      : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; font-size: 10.5pt; color: #1a202c; line-height: 1.5; }
  header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1d4ed8; padding-bottom: 5mm; margin-bottom: 8mm; }
  .brand { font-size: 16pt; font-weight: 700; color: #1d4ed8; }
  .doc { text-align: right; }
  .doc h1 { font-size: 14pt; letter-spacing: 0.08em; }
  .doc p { font-size: 9.5pt; color: #475569; }
  .parties { margin-bottom: 8mm; }
  .parties h2 { font-size: 9pt; text-transform: uppercase; letter-spacing: 0.06em; color: #64748b; }
  .parties p { font-weight: 600; }
  table.lines { width: 100%; border-collapse: collapse; margin-bottom: 6mm; }
  table.lines th { text-align: left; font-size: 9pt; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; border-bottom: 1px solid #cbd5e1; padding: 2mm 0; }
  table.lines td { padding: 2.5mm 0; border-bottom: 1px solid #eef2f7; }
  table.totals { width: 60mm; margin-left: auto; border-collapse: collapse; }
  table.totals td { padding: 1.5mm 0; }
  table.totals .num { text-align: right; font-variant-numeric: tabular-nums; }
  table.totals tr.total td { border-top: 1.5px solid #1d4ed8; font-weight: 700; padding-top: 2.5mm; }
  footer { margin-top: 12mm; font-size: 8.5pt; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 3mm; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
</style>
</head>
<body>
  <header>
    <div class="brand">Skill India Connect</div>
    <div class="doc">
      <h1>TAX INVOICE</h1>
      <p>Invoice no. <strong>${esc(data.number)}</strong></p>
      <p>Issued ${esc(issued)}</p>
    </div>
  </header>

  <div class="parties">
    <h2>Billed to</h2>
    <p>${esc(data.companyName)}</p>
    <p>${esc(data.companyLocation)}</p>
  </div>

  <table class="lines">
    <thead><tr><th>Description</th><th class="num">Amount</th></tr></thead>
    <tbody>
      <tr>
        <td>${esc(data.planName)} subscription</td>
        <td class="num">${esc(money(data.amountSubunits, data.currency))}</td>
      </tr>
    </tbody>
  </table>

  <table class="totals">
    <tbody>
      <tr><td>Subtotal</td><td class="num">${esc(money(data.amountSubunits, data.currency))}</td></tr>
      ${gstRow}
      <tr class="total"><td>Total</td><td class="num">${esc(money(data.totalSubunits, data.currency))}</td></tr>
    </tbody>
  </table>

  <footer>
    This is a system-generated invoice. Amounts are recorded in ${esc(data.currency)} at the
    time of payment. Invoice ${esc(data.number)} &middot; Skill India Connect.
  </footer>
</body>
</html>`;
}
