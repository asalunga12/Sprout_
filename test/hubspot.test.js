import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  registrationTypeValue,
  contactEventProps,
  PAYMENT_STATUS,
  hubspotProps,
} from '../config/hubspot.js';

// Valid event_registration_type options in the Sprout portal.
const VALID_TYPES = new Set([
  'Individual Registration',
  'Sprout Client Registration',
  'Group Registration',
  'Group Registration - Client',
  'Table Registration',
  'Startup Founder',
]);

test('payment status maps to the portal enum (Pending/Paid, never Unpaid)', () => {
  assert.equal(PAYMENT_STATUS.unpaid, 'Pending');
  assert.equal(PAYMENT_STATUS.paid, 'Paid');
});

test('individual registration type mapping', () => {
  assert.equal(
    registrationTypeValue({ kind: 'individual', customerType: 'nonclient' }),
    'Individual Registration'
  );
  assert.equal(
    registrationTypeValue({ kind: 'individual', customerType: 'client' }),
    'Sprout Client Registration'
  );
});

test('group registration type mapping', () => {
  assert.equal(
    registrationTypeValue({ kind: 'group', customerType: 'nonclient' }),
    'Group Registration'
  );
  assert.equal(
    registrationTypeValue({ kind: 'group', customerType: 'client' }),
    'Group Registration - Client'
  );
});

test('table registrations map to Table Registration', () => {
  assert.equal(
    registrationTypeValue({ registrationType: 'tablePublic', customerType: 'nonclient' }),
    'Table Registration'
  );
  assert.equal(
    registrationTypeValue({ registrationType: 'tableClient', customerType: 'client' }),
    'Table Registration'
  );
});

test('every mapping yields a value HubSpot will accept', () => {
  for (const kind of ['individual', 'group']) {
    for (const customerType of ['client', 'nonclient']) {
      const v = registrationTypeValue({ kind, customerType });
      assert.ok(VALID_TYPES.has(v), `${v} not a valid portal option`);
    }
  }
  for (const registrationType of ['tablePublic', 'tableClient', 'individual']) {
    const v = registrationTypeValue({ registrationType, customerType: 'nonclient' });
    assert.ok(VALID_TYPES.has(v), `${v} not a valid portal option`);
  }
});

test('contactEventProps writes the three event properties with portal values', () => {
  const props = contactEventProps({
    eventName: 'State of HR Summit 2026',
    kind: 'group',
    customerType: 'client',
    paid: false,
  });
  assert.equal(props[hubspotProps.eventName], 'State of HR Summit 2026');
  assert.equal(props[hubspotProps.registrationType], 'Group Registration - Client');
  assert.equal(props[hubspotProps.paymentStatus], 'Pending');

  const paidProps = contactEventProps({
    eventName: 'State of HR Summit 2026',
    kind: 'individual',
    customerType: 'nonclient',
    paid: true,
  });
  assert.equal(paidProps[hubspotProps.paymentStatus], 'Paid');
  assert.equal(paidProps[hubspotProps.registrationType], 'Individual Registration');
});

test('table registration (front-door kind) maps to Table Registration', () => {
  assert.equal(registrationTypeValue({ kind: 'table', customerType: 'nonclient' }), 'Table Registration');
  assert.equal(registrationTypeValue({ kind: 'table', customerType: 'client' }), 'Table Registration');
});
