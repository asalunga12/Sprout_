import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculatePricing, round2, isEarlyBird } from '../src/services/pricing.js';

test('individual, regular rate, 2 registrants, VAT decomposed', () => {
  const p = calculatePricing({
    registrationType: 'individual',
    quantity: 2,
    forceEarlyBird: false,
  });
  // regular = 5600 VAT-inclusive * 2 = 11200
  assert.equal(p.grossBeforeDiscount, 11200);
  assert.equal(p.total, 11200);
  // subtotal = 11200 / 1.12 = 10000 exactly
  assert.equal(p.subtotal, 10000);
  assert.equal(p.vat, 1200);
  // total ties out to subtotal + vat
  assert.equal(round2(p.subtotal + p.vat), p.total);
});

test('early-bird rate is applied when forced', () => {
  const p = calculatePricing({
    registrationType: 'individual',
    quantity: 1,
    forceEarlyBird: true,
  });
  assert.equal(p.earlyBird, true);
  assert.equal(p.unitPrice, 4480);
  assert.equal(p.total, 4480);
});

test('VAT-exempt strips the 12% (buyer pays the net)', () => {
  const p = calculatePricing({
    registrationType: 'individual',
    quantity: 1,
    vatExempt: true,
    forceEarlyBird: false,
  });
  assert.equal(p.vat, 0);
  // 5600 / 1.12 = 5000
  assert.equal(p.subtotal, 5000);
  assert.equal(p.total, 5000);
});

test('percent discount reduces the gross before VAT decomposition', () => {
  const p = calculatePricing({
    registrationType: 'individual',
    quantity: 1,
    discountCode: 'SPROUT10',
    forceEarlyBird: false,
  });
  // 10% of 5600 = 560 off -> gross 5040
  assert.equal(p.discountAmount, 560);
  assert.equal(p.total, 5040);
  assert.equal(p.subtotal, round2(5040 / 1.12));
});

test('fixed discount is capped and applied', () => {
  const p = calculatePricing({
    registrationType: 'individual',
    quantity: 1,
    discountCode: 'HR500',
    forceEarlyBird: false,
  });
  assert.equal(p.discountAmount, 500);
  assert.equal(p.total, 5100);
});

test('non-stackable code rejected during early bird', () => {
  assert.throws(
    () =>
      calculatePricing({
        registrationType: 'individual',
        quantity: 1,
        discountCode: 'EARLYVIP',
        forceEarlyBird: true,
      }),
    /cannot be combined with the early-bird/
  );
});

test('table registration multiplies by number of tables and reports seats', () => {
  const p = calculatePricing({
    registrationType: 'tableClient',
    quantity: 2,
    forceEarlyBird: false,
  });
  assert.equal(p.total, 100000); // 50000 * 2
  assert.equal(p.seats, 20); // 10 seats/table * 2
});

test('invalid discount code throws', () => {
  assert.throws(
    () => calculatePricing({ registrationType: 'individual', quantity: 1, discountCode: 'NOPE' }),
    /Invalid discount code/
  );
});

test('quantity must be positive', () => {
  assert.throws(
    () => calculatePricing({ registrationType: 'individual', quantity: 0 }),
    /positive number/
  );
});

test('isEarlyBird respects the cutoff date', () => {
  assert.equal(isEarlyBird('2026-05-01', '2026-05-31'), true);
  assert.equal(isEarlyBird('2026-06-01', '2026-05-31'), false);
});
