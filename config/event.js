// Static, non-secret configuration for the event and the seller (Sprout).
// Everything here is safe to commit and is meant to be edited per event.
import { env } from './env.js';

const SHOPIFY_DOMAIN = env('SHOPIFY_STORE_DOMAIN', '5zhckw-pf.myshopify.com');
const shopify = (p) => `https://${SHOPIFY_DOMAIN}${p}`;

export const seller = {
  name: 'Sprout Solutions Phil. Inc',
  addressLines: [
    'Rockwell Business Center Building North Tower 9th Floor',
    'Sheridan St, corner United St.',
    'Mandaluyong, NCR 1550',
  ],
  phone: '+63 9176275518',
  email: 'events@sprout.ph',
};

export const event = {
  // Shown on the SOA line item and used to tag HubSpot records.
  name: 'State of HR Summit 2026',
  code: 'SOHR2026',
  // Used to decide the early-bird window (see pricing config).
  // ISO date; registrations requested on/before this date qualify for early bird.
  earlyBirdCutoff: '2026-05-31',
  // Default payment terms shown on the SOA.
  termsDays: 30,
};

// Shopify checkout links shown in the SOA payment section. Individual
// registration uses a product/variant permalink; table registrations use
// dedicated landing pages that differ for clients vs. the general public.
export const shopifyLinks = {
  storeDomain: SHOPIFY_DOMAIN,
  individualProductHandle: 'the-state-of-hr-summit-2026',
  // Variant id from the sample SOA — the default individual-registration variant.
  individualVariantId: '53486544126266',
  individual: shopify(
    '/products/the-state-of-hr-summit-2026?variant=53486544126266'
  ),
  tableGeneralPublic: shopify('/pages/table-registration-regular'),
  tableClient: shopify('/pages/table-registration-client'),
};

export const banks = [
  {
    bank: 'Union Bank of the Philippines',
    accountName: 'Sprout Solutions Phil., Inc.',
    accountNumber: '001950000555',
    accountType: 'Checking',
    currency: 'Php',
  },
  {
    bank: 'Robinsons Bank',
    accountName: 'Sprout Solutions Phil., Inc.',
    accountNumber: '169230000079',
    accountType: 'Checking',
    currency: 'Php',
  },
];

// Free-text notes rendered under the payment section of the SOA.
export const paymentNotes = [
  'Kindly indicate Company Name and/or Invoice number on the remarks field ' +
    '(ex.: Sprout Solutions - INV00012345).',
  'Once payment has been made, kindly send the proof of payment at your ' +
    'earliest convenience. This will allow us to validate your payment and ' +
    'post it to our system promptly.',
];
