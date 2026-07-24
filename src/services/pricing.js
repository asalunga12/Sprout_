// Pricing engine: turns a registration/SOA request into a fully itemised,
// VAT-decomposed money breakdown.
//
// All unit prices in config are VAT-INCLUSIVE (gross). We compute:
//   gross     = unit price * quantity, less any discount
//   subtotal  = gross / (1 + VAT_RATE)          (net of VAT)
//   vat       = gross - subtotal                 (the 12% portion)
//   total     = gross
// For VAT-EXEMPT buyers the 12% is stripped: they pay `subtotal`, vat = 0.
import { rates, discountCodes, VAT_RATE, CURRENCY } from '../../config/pricing.js';
import { event } from '../../config/event.js';

/** Round to 2 decimal places (round-half-up), avoiding float dust. */
export function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Is the request within the early-bird window? */
export function isEarlyBird(requestDate = new Date(), cutoff = event.earlyBirdCutoff) {
  if (!cutoff) return false;
  const req = new Date(requestDate);
  const end = new Date(`${cutoff}T23:59:59`);
  return req.getTime() <= end.getTime();
}

/**
 * Compute the SOA money breakdown.
 *
 * @param {object} opts
 * @param {'individual'|'tablePublic'|'tableClient'} opts.registrationType
 * @param {number} opts.quantity            registrants (individual) or tables (table types)
 * @param {boolean} [opts.vatExempt=false]  strip the 12% VAT for VAT-exempt buyers
 * @param {string}  [opts.discountCode]     optional discount code
 * @param {boolean} [opts.forceEarlyBird]   override the automatic early-bird decision
 * @param {Date}    [opts.requestDate]      defaults to now (for early-bird evaluation)
 * @returns {object} breakdown
 */
export function calculatePricing(opts) {
  const {
    registrationType = 'individual',
    quantity,
    vatExempt = false,
    discountCode,
    forceEarlyBird,
    requestDate = new Date(),
  } = opts;

  const rate = rates[registrationType];
  if (!rate) {
    throw new Error(`Unknown registrationType: ${registrationType}`);
  }
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new Error(`quantity must be a positive number, got: ${quantity}`);
  }

  const earlyBird =
    typeof forceEarlyBird === 'boolean'
      ? forceEarlyBird
      : isEarlyBird(requestDate);
  const unitPrice = earlyBird ? rate.earlyBird : rate.regular;

  // Gross (VAT-inclusive) before discount.
  const grossBeforeDiscount = round2(unitPrice * qty);

  // --- Discount ---
  let discount = null;
  let discountAmount = 0;
  if (discountCode) {
    const code = String(discountCode).trim().toUpperCase();
    const def = discountCodes[code];
    if (!def) {
      throw new Error(`Invalid discount code: ${discountCode}`);
    }
    if (earlyBird && def.earlyBirdStackable === false) {
      throw new Error(
        `Discount code ${code} cannot be combined with the early-bird rate.`
      );
    }
    discountAmount =
      def.type === 'percent'
        ? round2((grossBeforeDiscount * def.value) / 100)
        : round2(Math.min(def.value, grossBeforeDiscount));
    discount = { code, ...def, amount: discountAmount };
  }

  const grossAfterDiscount = round2(grossBeforeDiscount - discountAmount);

  // --- VAT decomposition ---
  let subtotal;
  let vat;
  let total;
  if (vatExempt) {
    // VAT-exempt buyers do not pay the 12%; strip it off.
    subtotal = round2(grossAfterDiscount / (1 + VAT_RATE));
    vat = 0;
    total = subtotal;
  } else {
    subtotal = round2(grossAfterDiscount / (1 + VAT_RATE));
    vat = round2(grossAfterDiscount - subtotal); // ties out exactly to gross
    total = round2(subtotal + vat);
  }

  const seats = rate.perSeat ? qty : qty * rate.seatsPerUnit;

  return {
    currency: CURRENCY,
    registrationType,
    registrationLabel: rate.label,
    quantity: qty,
    seats, // total number of attendee seats represented
    earlyBird,
    unitPrice, // VAT-inclusive unit price applied
    unitPriceLabel: `${CURRENCY} ${fmt(unitPrice)} per ${
      rate.perSeat ? 'registrant' : 'table'
    } (VAT Inclusive)`,
    vatExempt,
    vatRate: VAT_RATE,
    grossBeforeDiscount,
    discount, // null or { code, type, value, label, amount }
    discountAmount,
    subtotal, // net of VAT
    vat, // 12% portion (0 when VAT-exempt)
    total, // balance due
    balanceDue: total,
    shopifyLinkKey: rate.shopifyLinkKey,
  };
}

/** Format a number as a thousands-separated 2dp string (no currency symbol). */
export function fmt(n) {
  return Number(n).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
