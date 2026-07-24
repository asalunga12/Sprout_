// Renders a Statement of Account to a PDF Buffer using pdfkit (pure JS, no
// native deps). Layout mirrors the sample SOA: seller header, BILL TO block,
// tracking/invoice/date/terms row, line-item table, totals, and the payment
// section (Shopify links + bank details + notes).
import PDFDocument from 'pdfkit';
import { fmt } from './pricing.js';

const BRAND = '#2E7D32'; // Sprout green
const GREY = '#666666';
const LIGHT = '#EEEEEE';

/** @returns {Promise<Buffer>} */
export function renderSOAPdf(soa) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const { pricing } = soa;
    const cur = pricing.currency;
    const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const left = doc.page.margins.left;
    const rightX = doc.page.width - doc.page.margins.right;

    // --- Seller header ---
    doc.fillColor(BRAND).fontSize(16).font('Helvetica-Bold').text(soa.seller.name);
    doc.moveDown(0.2);
    doc.fillColor(GREY).fontSize(9).font('Helvetica');
    soa.seller.addressLines.forEach((l) => doc.text(l));
    doc.text(soa.seller.phone);
    doc.text(soa.seller.email);

    // --- Title ---
    doc.moveDown(0.8);
    doc
      .fillColor('#000')
      .fontSize(20)
      .font('Helvetica-Bold')
      .text('STATEMENT OF ACCOUNT', { align: 'right' });

    // --- BILL TO + meta (two columns) ---
    doc.moveDown(0.6);
    const metaTop = doc.y;
    // Left: bill to
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#000').text('BILL TO:', left, metaTop);
    doc.font('Helvetica').fillColor(GREY);
    doc.text(soa.billTo.company, { width: pageW * 0.55 });
    if (soa.billTo.address) doc.text(soa.billTo.address, { width: pageW * 0.55 });
    if (soa.billTo.tin) doc.text(`TIN: ${soa.billTo.tin}`, { width: pageW * 0.55 });

    // Right: meta table
    const metaX = left + pageW * 0.6;
    const metaLabelW = 80;
    let my = metaTop;
    const metaRow = (k, v) => {
      doc.font('Helvetica-Bold').fillColor('#000').fontSize(9).text(k, metaX, my, { width: metaLabelW });
      doc.font('Helvetica').fillColor(GREY).text(v, metaX + metaLabelW, my, {
        width: rightX - (metaX + metaLabelW),
      });
      my += 14;
    };
    metaRow('TRACKING#:', soa.trackingNumber);
    metaRow('INVOICE:', soa.invoiceNumber);
    metaRow('DATE:', soa.date);
    metaRow('TERMS:', soa.terms);
    metaRow('DUE DATE:', soa.dueDate);

    doc.y = Math.max(doc.y, my) + 10;

    // --- Line item table ---
    const cols = [
      { key: 'date', label: 'DATE', w: 0.1 },
      { key: 'event', label: 'EVENT / REGISTRANTS', w: 0.46 },
      { key: 'qty', label: 'QTY', w: 0.1, align: 'right' },
      { key: 'php', label: 'PHP', w: 0.19, align: 'right' },
      { key: 'total', label: 'TOTAL', w: 0.15, align: 'right' },
    ];
    const colX = [];
    let acc = left;
    cols.forEach((c) => {
      colX.push(acc);
      acc += pageW * c.w;
    });

    // header row
    const headY = doc.y;
    doc.rect(left, headY, pageW, 18).fill(BRAND);
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(9);
    cols.forEach((c, i) => {
      doc.text(c.label, colX[i] + 4, headY + 5, {
        width: pageW * c.w - 8,
        align: c.align || 'left',
      });
    });
    doc.y = headY + 18;

    // registrants text block
    const registrantsText = soa.registrants.length
      ? soa.registrants.map((r) => `${r.name}  ${r.email}`.trim()).join('\n')
      : '';
    const eventBlock = [soa.event.name, registrantsText, pricing.unitPriceLabel]
      .filter(Boolean)
      .join('\n');

    const rowY = doc.y + 4;
    doc.fillColor('#000').font('Helvetica').fontSize(9);
    doc.text(soa.date, colX[0] + 4, rowY, { width: pageW * cols[0].w - 8 });
    const eventH = doc.heightOfString(eventBlock, { width: pageW * cols[1].w - 8 });
    doc.text(eventBlock, colX[1] + 4, rowY, { width: pageW * cols[1].w - 8 });
    doc.text(String(pricing.quantity), colX[2] + 4, rowY, {
      width: pageW * cols[2].w - 8,
      align: 'right',
    });
    doc.text(`${cur} ${fmt(pricing.unitPrice)}`, colX[3] + 4, rowY, {
      width: pageW * cols[3].w - 8,
      align: 'right',
    });
    doc.text(`${cur} ${fmt(pricing.grossBeforeDiscount)}`, colX[4] + 4, rowY, {
      width: pageW * cols[4].w - 8,
      align: 'right',
    });
    doc.y = rowY + Math.max(eventH, 12) + 8;
    doc.moveTo(left, doc.y).lineTo(rightX, doc.y).strokeColor(LIGHT).stroke();

    // --- Totals ---
    doc.moveDown(0.5);
    const totalsX = left + pageW * 0.55;
    const totalsLabelW = pageW * 0.28;
    const totalsValW = rightX - (totalsX + totalsLabelW);
    const totalLine = (label, value, opts = {}) => {
      const y = doc.y;
      doc
        .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(opts.bold ? 11 : 10)
        .fillColor(opts.color || '#000')
        .text(label, totalsX, y, { width: totalsLabelW, align: 'right' });
      doc.text(value, totalsX + totalsLabelW, y, {
        width: totalsValW,
        align: 'right',
      });
      doc.moveDown(0.35);
    };

    if (pricing.discount) {
      totalLine(
        `Discount (${pricing.discount.code}):`,
        `- ${cur} ${fmt(pricing.discountAmount)}`,
        { color: GREY }
      );
    }
    totalLine('SUBTOTAL:', `${cur} ${fmt(pricing.subtotal)}`);
    totalLine(
      pricing.vatExempt ? 'VAT (VAT-Exempt):' : 'TAX (12%):',
      `${cur} ${fmt(pricing.vat)}`
    );
    totalLine('TOTAL:', `${cur} ${fmt(pricing.total)}`, { bold: true });
    totalLine('BALANCE DUE:', `${cur} ${fmt(pricing.balanceDue)}`, {
      bold: true,
      color: BRAND,
    });

    // --- Payment section ---
    doc.moveDown(1);
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#000').text(
      'Kindly settle the payment through the following:'
    );
    doc.moveDown(0.3);

    // Primary (customised) link
    doc.font('Helvetica-Bold').fontSize(9).fillColor(BRAND).text(
      `${soa.checkout.primary.label} (recommended for you):`
    );
    doc.font('Helvetica').fillColor('#0645AD').text(soa.checkout.primary.url, {
      link: soa.checkout.primary.url,
      underline: true,
    });
    doc.moveDown(0.3);

    // Standard options
    doc.font('Helvetica').fontSize(9).fillColor('#000');
    soa.checkout.options.forEach((o) => {
      doc.fillColor('#000').font('Helvetica-Bold').text(`${o.label}: `, {
        continued: true,
      });
      doc.font('Helvetica').fillColor('#0645AD').text(o.url, {
        link: o.url,
        underline: true,
      });
    });

    // Bank deposit
    doc.moveDown(0.6);
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#000')
      .text('Otherwise, you may also settle via bank deposit:');
    doc.moveDown(0.2);
    soa.banks.forEach((b) => {
      doc.font('Helvetica-Bold').fillColor('#000').text(b.bank);
      doc
        .font('Helvetica')
        .fillColor(GREY)
        .text(
          `Account name: ${b.accountName}   |   Account #: ${b.accountNumber}   |   ${b.accountType} (${b.currency})`
        );
      doc.moveDown(0.2);
    });

    // Notes
    doc.moveDown(0.3).fillColor(GREY).fontSize(8);
    soa.paymentNotes.forEach((n) => {
      doc.text(n, { width: pageW });
      doc.moveDown(0.2);
    });

    doc.end();
  });
}
