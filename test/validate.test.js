import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseRegistrants } from '../src/lib/validate.js';

test('normaliseRegistrants preserves name, title and email', () => {
  const out = normaliseRegistrants([
    { name: 'Aira Santos', title: 'People Ops Lead', email: 'aira@x.com' },
  ]);
  assert.deepEqual(out, [
    { name: 'Aira Santos', title: 'People Ops Lead', email: 'aira@x.com' },
  ]);
});

test('normaliseRegistrants drops fully empty rows', () => {
  const out = normaliseRegistrants([
    { name: '', title: '', email: '' },
    { name: 'Deo', title: '', email: '' },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, 'Deo');
});
