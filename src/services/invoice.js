// "Request for sales invoice" adapter. Triggered once a payment is confirmed.
//
// Modes (INVOICE_REQUEST_MODE):
//   email   -> emails the finance team a structured request to issue the SI.
//   webhook -> POSTs a JSON payload to INVOICE_REQUEST_WEBHOOK_URL (e.g. an
//              accounting-system endpoint, Zapier/Make, or an internal queue).
//   none    -> disabled (logs only).
import { env } from '../../config/env.js';
import { sendMail } from './email.js';
import { fmt } from './pricing.js';

export async function requestSalesInvoice(soa, payment = {}) {
  const mode = (env('INVOICE_REQUEST_MODE', 'email') || 'email').toLowerCase();
  const p = soa.pricing;
  const cur = p.currency;

  const payload = {
    type: 'sales_invoice_request',
    createdAt: new Date().toISOString(),
    event: soa.event,
    invoiceNumber: soa.invoiceNumber,
    trackingNumber: soa.trackingNumber,
    billTo: soa.billTo,
    requestor: soa.requestor,
    customerType: soa.customerType,
    registrants: soa.registrants,
    amounts: {
      currency: cur,
      subtotal: p.subtotal,
      vat: p.vat,
      vatExempt: p.vatExempt,
      total: p.total,
    },
    payment: {
      reference: payment.reference ?? null,
      source: payment.source ?? 'shopify',
      paidAt: payment.paidAt ?? new Date().toISOString(),
      amount: payment.amount ?? p.total,
    },
  };

  if (mode === 'none') {
    console.warn('[invoice] INVOICE_REQUEST_MODE=none — skipping SI request.');
    return { mode, sent: false, payload };
  }

  if (mode === 'webhook') {
    const url = env('INVOICE_REQUEST_WEBHOOK_URL');
    if (!url) {
      console.warn('[invoice] webhook mode but INVOICE_REQUEST_WEBHOOK_URL unset.');
      return { mode, sent: false, payload };
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return { mode, sent: res.ok, status: res.status, payload };
  }

  // Default: email finance.
  const to = env('INVOICE_REQUEST_EMAIL', 'finance@sprout.ph');
  const subject = `Sales Invoice Request — ${soa.billTo.company || soa.requestor.name} (${soa.invoiceNumber})`;
  const rows = [
    ['Event', soa.event.name],
    ['Invoice #', soa.invoiceNumber],
    ['Tracking #', soa.trackingNumber],
    ['Bill To', soa.billTo.company],
    ['TIN', soa.billTo.tin],
    ['Address', soa.billTo.address],
    ['Customer Type', soa.customerType],
    ['Registrants', soa.registrants.map((r) => `${r.name} <${r.email}>`).join('; ')],
    ['Subtotal', `${cur} ${fmt(p.subtotal)}`],
    [p.vatExempt ? 'VAT (Exempt)' : 'VAT (12%)', `${cur} ${fmt(p.vat)}`],
    ['Total Paid', `${cur} ${fmt(payload.payment.amount)}`],
    ['Payment Ref', payload.payment.reference ?? '—'],
  ];
  const html = `<h3>Request for Sales Invoice</h3>
    <p>Payment has been confirmed. Kindly issue the sales invoice for:</p>
    <table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px;">
      ${rows
        .map(
          ([k, v]) =>
            `<tr><td style="padding:4px 10px;color:#666;">${k}</td><td style="padding:4px 10px;font-weight:bold;">${v ?? '—'}</td></tr>`
        )
        .join('')}
    </table>`;
  const text = rows.map(([k, v]) => `${k}: ${v ?? '—'}`).join('\n');

  const result = await sendMail({ to, subject, html, text });
  return { mode, sent: result.delivered || result.mode === 'outbox', payload, mail: result };
}
