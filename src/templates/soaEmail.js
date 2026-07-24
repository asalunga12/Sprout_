// Builds the HTML + plain-text body of the SOA email. Kept framework-free so
// it renders reliably across mail clients (inline styles, table layout).
import { fmt } from '../services/pricing.js';

export function soaEmailSubject(soa) {
  return `Statement of Account — ${soa.event.name} (${soa.invoiceNumber})`;
}

export function soaEmailText(soa) {
  const p = soa.pricing;
  const cur = p.currency;
  const lines = [
    `Statement of Account — ${soa.event.name}`,
    ``,
    `Bill To: ${soa.billTo.company}`,
    soa.billTo.tin ? `TIN: ${soa.billTo.tin}` : ``,
    ``,
    `Tracking #: ${soa.trackingNumber}`,
    `Invoice: ${soa.invoiceNumber}`,
    `Date: ${soa.date}   Terms: ${soa.terms}   Due: ${soa.dueDate}`,
    ``,
    `Registration: ${p.registrationLabel}`,
    `Quantity: ${p.quantity}  (${p.seats} seat/s)`,
    `Rate: ${cur} ${fmt(p.unitPrice)} ${p.earlyBird ? '(Early Bird) ' : ''}(VAT Inclusive)`,
    p.discount ? `Discount (${p.discount.code}): -${cur} ${fmt(p.discountAmount)}` : ``,
    `Subtotal: ${cur} ${fmt(p.subtotal)}`,
    `${p.vatExempt ? 'VAT (VAT-Exempt)' : 'Tax (12%)'}: ${cur} ${fmt(p.vat)}`,
    `TOTAL / Balance Due: ${cur} ${fmt(p.total)}`,
    ``,
    `Pay here (${soa.checkout.primary.label}): ${soa.checkout.primary.url}`,
    ``,
    `The full Statement of Account is attached as a PDF.`,
  ];
  return lines.filter((l) => l !== '').join('\n');
}

export function soaEmailHtml(soa) {
  const p = soa.pricing;
  const cur = p.currency;
  const brand = '#2E7D32';
  const registrants = soa.registrants.length
    ? soa.registrants
        .map((r) => `<div>${esc(r.name)} &nbsp;<span style="color:#888">${esc(r.email)}</span></div>`)
        .join('')
    : '<em>See attached</em>';

  const row = (label, value, opts = {}) => `
    <tr>
      <td style="padding:4px 8px;text-align:right;color:#444;${opts.bold ? 'font-weight:bold;' : ''}">${label}</td>
      <td style="padding:4px 8px;text-align:right;${opts.bold ? 'font-weight:bold;' : ''}${opts.color ? `color:${opts.color};` : ''}">${value}</td>
    </tr>`;

  return `<!doctype html>
<html><body style="margin:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;color:#222;">
  <div style="max-width:640px;margin:0 auto;background:#fff;">
    <div style="background:${brand};color:#fff;padding:20px 24px;">
      <div style="font-size:18px;font-weight:bold;">${esc(soa.seller.name)}</div>
      <div style="font-size:12px;opacity:.9;">${esc(soa.seller.email)} · ${esc(soa.seller.phone)}</div>
    </div>
    <div style="padding:24px;">
      <h2 style="margin:0 0 4px;">Statement of Account</h2>
      <div style="color:#666;margin-bottom:16px;">${esc(soa.event.name)}</div>

      <table style="width:100%;font-size:13px;border-collapse:collapse;margin-bottom:16px;">
        <tr><td style="color:#888;">Bill To</td><td style="text-align:right;font-weight:bold;">${esc(soa.billTo.company)}</td></tr>
        ${soa.billTo.tin ? `<tr><td style="color:#888;">TIN</td><td style="text-align:right;">${esc(soa.billTo.tin)}</td></tr>` : ''}
        <tr><td style="color:#888;">Tracking #</td><td style="text-align:right;">${esc(soa.trackingNumber)}</td></tr>
        <tr><td style="color:#888;">Invoice</td><td style="text-align:right;">${esc(soa.invoiceNumber)}</td></tr>
        <tr><td style="color:#888;">Date · Terms · Due</td><td style="text-align:right;">${esc(soa.date)} · ${esc(soa.terms)} · ${esc(soa.dueDate)}</td></tr>
      </table>

      <div style="border:1px solid #eee;border-radius:6px;padding:12px 14px;margin-bottom:16px;">
        <div style="font-weight:bold;margin-bottom:6px;">${esc(p.registrationLabel)} — Qty ${p.quantity}${p.earlyBird ? ' · Early Bird' : ''}</div>
        <div style="font-size:12px;color:#555;margin-bottom:6px;">${registrants}</div>
        <div style="font-size:12px;color:#888;">${esc(p.unitPriceLabel)}</div>
      </div>

      <table style="width:100%;font-size:13px;border-collapse:collapse;margin-bottom:20px;">
        ${p.discount ? row(`Discount (${esc(p.discount.code)})`, `- ${cur} ${fmt(p.discountAmount)}`, { color: '#888' }) : ''}
        ${row('Subtotal', `${cur} ${fmt(p.subtotal)}`)}
        ${row(p.vatExempt ? 'VAT (VAT-Exempt)' : 'Tax (12%)', `${cur} ${fmt(p.vat)}`)}
        ${row('Total', `${cur} ${fmt(p.total)}`, { bold: true })}
        ${row('Balance Due', `${cur} ${fmt(p.balanceDue)}`, { bold: true, color: brand })}
      </table>

      <a href="${esc(soa.checkout.primary.url)}"
         style="display:inline-block;background:${brand};color:#fff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:bold;">
         Pay now — ${esc(soa.checkout.primary.label)}
      </a>

      <p style="font-size:12px;color:#666;margin-top:20px;">
        The full Statement of Account is attached as a PDF, including bank-deposit
        details and all payment options. Kindly indicate your Company Name and/or
        Invoice number on the remarks field when paying.
      </p>
    </div>
    <div style="background:#fafafa;color:#999;font-size:11px;padding:14px 24px;">
      ${esc(soa.seller.name)} · ${soa.seller.addressLines.map(esc).join(', ')}
    </div>
  </div>
</body></html>`;
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
