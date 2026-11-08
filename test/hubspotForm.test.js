import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFields } from '../src/services/hubspotForm.js';

test('buildFields maps a full contact to HubSpot form fields', () => {
  const fields = buildFields({
    name: 'Juan Dela Cruz',
    email: 'juan@acme.com',
    title: 'HR Manager',
    company: 'Acme Corp',
    mobile: '+63 900',
  });
  const byName = Object.fromEntries(fields.map((f) => [f.name, f.value]));
  assert.equal(byName.email, 'juan@acme.com');
  assert.equal(byName.firstname, 'Juan');
  assert.equal(byName.lastname, 'Dela Cruz');
  assert.equal(byName.jobtitle, 'HR Manager');
  assert.equal(byName.company, 'Acme Corp');
  assert.equal(byName.mobilephone, '+63 900');
  // every field is a contact field
  assert.ok(fields.every((f) => f.objectTypeId === '0-1'));
});

test('buildFields omits empty values (no title/company/mobile)', () => {
  const fields = buildFields({ name: 'Ana Reyes', email: 'ana@x.com' });
  const names = fields.map((f) => f.name);
  assert.deepEqual(names.sort(), ['email', 'firstname', 'lastname'].sort());
  assert.ok(!names.includes('jobtitle'));
  assert.ok(!names.includes('company'));
  assert.ok(!names.includes('mobilephone'));
});

test('buildFields splits single-word names without a lastname value', () => {
  const fields = buildFields({ name: 'Madonna', email: 'm@x.com' });
  const byName = Object.fromEntries(fields.map((f) => [f.name, f.value]));
  assert.equal(byName.firstname, 'Madonna');
  // lastname empty -> omitted
  assert.equal(byName.lastname, undefined);
});
