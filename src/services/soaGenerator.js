// Assembles a complete Statement of Account record from a validated SOA
// request. The returned object is the single source of truth used for the
// PDF, the email, HubSpot, and persistence.
import { calculatePricing } from './pricing.js';
import { buildCheckout } from './shopify.js';
import { nextTrackingNumber, nextInvoiceNumber } from '../lib/store.js';
import { seller, event, banks, paymentNotes } from '../../config/event.js';

/** Add `days` to a date, return YYYY-MM-DD. */
function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function ymd(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

/**
 * @param {object} req  validated SOA request
 * @param {object} req.billTo   { company, address, tin }
 * @param {object} req.requestor { name, email }
 * @param {Array}  req.registrants [{ name, email }]
 * @param {string} req.registrationType
 * @param {number} [req.quantity]  defaults to registrants.length for individual
 * @param {boolean}[req.vatExempt]
 * @param {string} [req.discountCode]
 * @param {boolean}[req.forceEarlyBird]
 * @param {'client'|'prospect'} [req.customerType]
 * @param {Date}   [now]
 */
export function generateSOA(req, now = new Date()) {
  const registrants = req.registrants ?? [];
  // For individual registration, quantity defaults to the number of registrants.
  const quantity =
    req.quantity ??
    (req.registrationType === 'individual' ? registrants.length : 1);

  const pricing = calculatePricing({
    registrationType: req.registrationType,
    quantity,
    vatExempt: !!req.vatExempt,
    discountCode: req.discountCode,
    forceEarlyBird: req.forceEarlyBird,
    requestDate: now,
  });

  const customerType = req.customerType === 'client' ? 'client' : 'prospect';
  const checkout = buildCheckout({ pricing, customerType });

  const trackingNumber = nextTrackingNumber();
  const invoiceNumber = nextInvoiceNumber();
  const dueDate = addDays(now, event.termsDays);

  return {
    // identifiers
    trackingNumber,
    invoiceNumber,
    status: 'issued', // issued -> paid -> invoiced
    paymentStatus: 'Pending', // mirrors HubSpot "Event Payment Status" (Pending|Paid)
    createdAt: now.toISOString(),

    // parties
    seller,
    billTo: {
      company: req.billTo?.company ?? '',
      address: req.billTo?.address ?? '',
      tin: req.billTo?.tin ?? '',
    },
    requestor: {
      name: req.requestor?.name ?? '',
      email: req.requestor?.email ?? '',
    },
    customerType,

    // event + line items
    event: { name: event.name, code: event.code },
    date: ymd(now),
    dueDate: ymd(dueDate),
    terms: `Net ${event.termsDays}`,
    registrants,
    pricing,

    // payment
    checkout,
    banks,
    paymentNotes,
  };
}
