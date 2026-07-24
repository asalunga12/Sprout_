// Pricing configuration for the event.
//
// IMPORTANT: the money values below are PLACEHOLDERS. Replace them with the
// finalized rates for your event. The pricing ENGINE (src/services/pricing.js)
// is generic and does not need to change when you edit these numbers.
//
// Convention used throughout: all unit prices are **VAT-INCLUSIVE** (gross),
// matching the sample SOA where the per-registrant figure is labelled
// "(VAT Inclusive)". The engine decomposes gross into net subtotal + 12% VAT.

export const CURRENCY = 'PHP';
export const VAT_RATE = 0.12;

// Registration types. `unit` is what a single quantity costs (VAT-inclusive):
//   - individual        -> price per registrant
//   - tablePublic/Client -> price per table (a table seats `seatsPerTable`)
//
// Each type has a `regular` and an `earlyBird` price. Whether early-bird
// applies is decided at request time from `event.earlyBirdCutoff`, or forced
// on/off per request.
export const rates = {
  individual: {
    label: 'Individual Registration',
    perSeat: true, // quantity == number of registrants
    seatsPerUnit: 1,
    regular: 5600, // PLACEHOLDER — VAT-inclusive price per registrant
    earlyBird: 4480, // PLACEHOLDER — VAT-inclusive early-bird price per registrant
    shopifyLinkKey: 'individual',
  },
  tablePublic: {
    label: 'Table Registration (General Public)',
    perSeat: false, // quantity == number of tables
    seatsPerUnit: 10,
    regular: 56000, // PLACEHOLDER — VAT-inclusive price per table
    earlyBird: 44800, // PLACEHOLDER
    shopifyLinkKey: 'tableGeneralPublic',
  },
  tableClient: {
    label: 'Table Registration (Client)',
    perSeat: false,
    seatsPerUnit: 10,
    regular: 50000, // PLACEHOLDER — discounted client table rate (VAT-inclusive)
    earlyBird: 40000, // PLACEHOLDER
    shopifyLinkKey: 'tableClient',
  },
};

// Discount codes applied on top of the selected rate.
//   type: 'percent' -> `value`% off the VAT-inclusive subtotal
//   type: 'fixed'   -> flat `value` (in CURRENCY) off the VAT-inclusive subtotal
// `earlyBirdStackable: false` means the code cannot be combined with early bird.
export const discountCodes = {
  SPROUT10: {
    type: 'percent',
    value: 10,
    label: '10% partner discount',
    earlyBirdStackable: true,
  },
  HR500: {
    type: 'fixed',
    value: 500,
    label: 'PHP 500 off',
    earlyBirdStackable: true,
  },
  EARLYVIP: {
    type: 'percent',
    value: 15,
    label: '15% VIP discount',
    earlyBirdStackable: false,
  },
};
