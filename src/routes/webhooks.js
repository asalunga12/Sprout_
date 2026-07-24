// Inbound webhooks. Currently: Shopify "order paid".
//
// POST /webhooks/shopify/order-paid
//   1. Verify HMAC (if a secret is configured).
//   2. Match the order to a stored SOA (by invoice # in the note, or by
//      requestor/registrant email).
//   3. Mark the SOA paid, raise a sales-invoice request, and update the
//      HubSpot "Event Payment Status" property to "Paid".
//
// The router is mounted with a RAW body parser (see server.js), so req.body is
// a Buffer here.
import express from 'express';
import { store } from '../lib/store.js';
import { verifyWebhook } from '../services/shopify.js';
import { requestSalesInvoice } from '../services/invoice.js';
import { updatePaymentStatus } from '../services/hubspot.js';
import { envBool } from '../../config/env.js';

const router = express.Router();

function parseRaw(req) {
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
  return { raw, json: raw ? JSON.parse(raw) : {} };
}

/** Find the SOA that a paid order corresponds to. */
function matchSoa(order) {
  const soas = store.all('soa');
  const emails = new Set(
    [
      order.email,
      order.contact_email,
      order.customer?.email,
    ]
      .filter(Boolean)
      .map((e) => e.toLowerCase())
  );
  const note = `${order.note || ''} ${(order.note_attributes || [])
    .map((a) => `${a.name}:${a.value}`)
    .join(' ')}`;

  // 1) Strongest: invoice/tracking number referenced in the note.
  let hit = soas.find(
    (s) =>
      (s.invoiceNumber && note.includes(s.invoiceNumber)) ||
      (s.trackingNumber && note.includes(`#${s.trackingNumber}`))
  );
  if (hit) return hit;

  // 2) Match by email among unpaid SOAs (most recent first).
  const byEmail = soas
    .filter((s) => s.status !== 'paid')
    .filter((s) => {
      const cand = [s.requestor?.email, ...(s.registrants || []).map((r) => r.email)]
        .filter(Boolean)
        .map((e) => e.toLowerCase());
      return cand.some((e) => emails.has(e));
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return byEmail[0] || null;
}

async function handleOrderPaid(req, res) {
  const { raw, json: order } = parseRaw(req);

  // HMAC verification.
  const verified = verifyWebhook(raw, req.get('X-Shopify-Hmac-Sha256'));
  if (verified === false) {
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }
  if (verified === null && !envBool('ALLOW_UNVERIFIED_WEBHOOKS', true)) {
    return res.status(401).json({ error: 'Webhook secret not configured' });
  }

  const soa = matchSoa(order);
  if (!soa) {
    console.warn(
      `[webhook] order ${order.id || order.name} paid but no matching SOA found ` +
        `(email=${order.email || order.customer?.email || '-'}).`
    );
    // 200 so Shopify doesn't retry forever; log for manual reconciliation.
    return res.status(200).json({ ok: true, matched: false });
  }

  // Idempotency: Shopify may deliver the same event more than once. Once a
  // payment has been recorded (status advances paid -> invoiced), do nothing.
  if (soa.paymentStatus === 'Paid' || soa.status === 'paid' || soa.status === 'invoiced') {
    return res.status(200).json({ ok: true, alreadyProcessed: true, tracking: soa.trackingNumber });
  }

  const payment = {
    source: 'shopify',
    reference: order.name || String(order.id || ''),
    paidAt: order.processed_at || order.created_at || new Date().toISOString(),
    amount: order.total_price ? Number(order.total_price) : soa.pricing.total,
  };

  // Mark paid.
  store.update('soa', (s) => s.trackingNumber === soa.trackingNumber, {
    status: 'paid',
    paymentStatus: 'Paid',
    payment,
  });

  // Raise the sales-invoice request.
  let invoice = null;
  try {
    invoice = await requestSalesInvoice(soa, payment);
    store.update('soa', (s) => s.trackingNumber === soa.trackingNumber, {
      status: 'invoiced',
      invoiceRequest: { sent: invoice.sent, mode: invoice.mode },
    });
  } catch (e) {
    console.error(`[webhook] sales-invoice request failed: ${e.message}`);
  }

  // Update HubSpot Event Payment Status -> Paid.
  let hubspot = null;
  try {
    hubspot = await updatePaymentStatus({
      dealId: soa.hubspot?.dealId,
      contactEmail: soa.requestor?.email,
      status: 'Paid',
    });
  } catch (e) {
    console.error(`[webhook] HubSpot payment-status update failed: ${e.message}`);
  }

  console.log(
    `[webhook] SOA ${soa.trackingNumber} marked paid; invoice=${invoice?.sent}; hubspot=${JSON.stringify(hubspot)}`
  );
  return res.status(200).json({
    ok: true,
    matched: true,
    tracking: soa.trackingNumber,
    invoiceRequested: !!invoice?.sent,
    hubspot,
  });
}

// Shopify can be pointed at either path; support both.
router.post('/shopify/order-paid', handleOrderPaid);
router.post('/shopify', handleOrderPaid);

export default router;
