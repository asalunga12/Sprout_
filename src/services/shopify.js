// Shopify adapter.
//
// Two responsibilities:
//   1. Build the checkout link shown on the SOA, customised to the requestor
//      (individual cart permalink with quantity + optional discount; or the
//      client vs. general-public table-registration pages).
//   2. Verify inbound order webhooks (HMAC) so we only act on genuine
//      "order paid" events.
import crypto from 'node:crypto';
import { shopifyLinks } from '../../config/event.js';
import { env } from '../../config/env.js';

/**
 * Build the primary, customised checkout link for a requestor.
 *
 * @param {object} opts
 * @param {object} opts.pricing        result of calculatePricing()
 * @param {'client'|'prospect'} opts.customerType
 * @returns {{ primary: {label,url}, options: Array<{label,url}> }}
 */
export function buildCheckout({ pricing, customerType }) {
  const domain = shopifyLinks.storeDomain;
  const isClient = customerType === 'client';

  let primary;
  if (pricing.registrationType === 'individual') {
    // Cart permalink: /cart/{variantId}:{qty}. Pre-fills the cart with the
    // exact number of registrants; discount code is applied at checkout.
    const qty = pricing.seats; // one seat per registrant
    let url = `https://${domain}/cart/${shopifyLinks.individualVariantId}:${qty}`;
    if (pricing.discount?.code) {
      url += `?discount=${encodeURIComponent(pricing.discount.code)}`;
    }
    primary = { label: `Individual Registration (x${qty})`, url };
  } else {
    // Table registration — pick client vs. general-public landing page.
    const wantClient = pricing.registrationType === 'tableClient' || isClient;
    primary = wantClient
      ? { label: 'Table Registration (Client)', url: shopifyLinks.tableClient }
      : {
          label: 'Table Registration (General Public)',
          url: shopifyLinks.tableGeneralPublic,
        };
  }

  // Always surface the standard set of links too (mirrors the sample SOA),
  // but lead with the one that matches this requestor.
  const options = [
    { label: 'Individual Registration', url: shopifyLinks.individual },
    {
      label: 'Table Registration (General Public)',
      url: shopifyLinks.tableGeneralPublic,
    },
    { label: 'Table Registration (Client)', url: shopifyLinks.tableClient },
  ];

  return { primary, options };
}

/**
 * Verify a Shopify webhook HMAC signature.
 * @param {Buffer|string} rawBody raw request body bytes
 * @param {string} hmacHeader value of X-Shopify-Hmac-Sha256
 * @returns {boolean}
 */
export function verifyWebhook(rawBody, hmacHeader) {
  const secret = env('SHOPIFY_WEBHOOK_SECRET');
  if (!secret) {
    // No secret configured -> cannot verify. Caller decides whether to trust
    // (in dev we allow it through with a warning).
    return null;
  }
  if (!hmacHeader) return false;
  const digest = crypto
    .createHmac('sha256', secret)
    .update(rawBody, 'utf8')
    .digest('base64');
  try {
    return crypto.timingSafeEqual(
      Buffer.from(digest),
      Buffer.from(hmacHeader)
    );
  } catch {
    return false;
  }
}
