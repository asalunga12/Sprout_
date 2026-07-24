import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

// Isolate the JSON store to a temp dir so tests don't touch ./data.
process.env.DATA_DIR = path.join(os.tmpdir(), `soa-test-${process.pid}`);

const { generateSOA } = await import('../src/services/soaGenerator.js');
const { renderSOAPdf } = await import('../src/services/pdf.js');
const { buildCheckout } = await import('../src/services/shopify.js');

test('generateSOA builds a complete record with derived quantity', () => {
  const soa = generateSOA(
    {
      billTo: { company: 'KONEKTAO Global BPO Corporation', tin: '010970942' },
      requestor: { name: 'Jessa Jean Miranda', email: 'hr@konektao.com' },
      registrants: [
        { name: 'Jessa Jean Miranda', email: 'hr@konektao.com' },
        { name: 'Kristine Claire Honrade', email: 'payroll@konektao.com' },
      ],
      registrationType: 'individual',
      customerType: 'prospect',
      forceEarlyBird: false,
    },
    new Date('2026-06-24T00:00:00')
  );

  assert.equal(soa.pricing.quantity, 2); // derived from 2 registrants
  assert.ok(soa.trackingNumber);
  assert.match(soa.invoiceNumber, /^INV-/);
  assert.equal(soa.terms, 'Net 30');
  assert.equal(soa.date, '2026-06-24');
  assert.equal(soa.dueDate, '2026-07-24');
  assert.ok(soa.checkout.primary.url.includes('/cart/'));
});

test('individual checkout permalink carries quantity and discount', () => {
  const pricing = {
    registrationType: 'individual',
    seats: 3,
    discount: { code: 'SPROUT10' },
  };
  const { primary } = buildCheckout({ pricing, customerType: 'prospect' });
  assert.match(primary.url, /\/cart\/\d+:3/);
  assert.match(primary.url, /discount=SPROUT10/);
});

test('client table registration points at the client landing page', () => {
  const { primary } = buildCheckout({
    pricing: { registrationType: 'tableClient', seats: 10 },
    customerType: 'client',
  });
  assert.match(primary.url, /table-registration-client/);
});

test('renderSOAPdf returns a non-trivial PDF buffer', async () => {
  const soa = generateSOA(
    {
      billTo: { company: 'Acme Inc', tin: '123' },
      requestor: { name: 'Test User', email: 'test@acme.com' },
      registrants: [{ name: 'Test User', email: 'test@acme.com' }],
      registrationType: 'individual',
    },
    new Date('2026-06-24T00:00:00')
  );
  const pdf = await renderSOAPdf(soa);
  assert.ok(Buffer.isBuffer(pdf));
  assert.ok(pdf.length > 1000);
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
});
