import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseRegistrants } from '../src/lib/validate.js';

test('normaliseRegistrants preserves name, title, email and mobile', () => {
  const out = normaliseRegistrants([
    { name: 'Aira Santos', title: 'People Ops Lead', email: 'aira@x.com', mobile: '+63 900 000 0000' },
  ]);
  assert.deepEqual(out, [
    { name: 'Aira Santos', title: 'People Ops Lead', email: 'aira@x.com', mobile: '+63 900 000 0000' },
  ]);
});

test('normaliseRegistrants defaults a missing mobile to empty', () => {
  const out = normaliseRegistrants([
    { name: 'Aira Santos', title: 'People Ops Lead', email: 'aira@x.com' },
  ]);
  assert.equal(out[0].mobile, '');
});

test('normaliseRegistrants drops fully empty rows', () => {
  const out = normaliseRegistrants([
    { name: '', title: '', email: '' },
    { name: 'Deo', title: '', email: '' },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, 'Deo');
});
