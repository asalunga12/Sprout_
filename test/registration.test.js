import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

// Isolate the JSON store to an empty temp dir BEFORE importing the route (and
// therefore the store), so uniqueness checks run against a clean table.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'regtest-'));
const { generateRegistrationNumber, ensureRegistrationNumber } = await import(
  '../src/routes/registration.js'
);

test('generateRegistrationNumber has the SC27-XXXXXXXX shape', () => {
  for (let i = 0; i < 50; i++) {
    assert.match(generateRegistrationNumber(), /^SC27-[0-9A-Z]{8}$/);
  }
});

test('generateRegistrationNumber is effectively unique', () => {
  const seen = new Set();
  for (let i = 0; i < 1000; i++) seen.add(generateRegistrationNumber());
  assert.ok(seen.size > 990, `expected mostly-unique numbers, got ${seen.size}/1000`);
});

test('ensureRegistrationNumber keeps a valid, unused candidate', () => {
  assert.equal(ensureRegistrationNumber('SC27-ABCD1234'), 'SC27-ABCD1234');
});

test('ensureRegistrationNumber replaces an invalid/missing candidate', () => {
  for (const bad of ['nope', '', undefined, null, 'sc27-abcd1234', 'SC27-SHORT']) {
    assert.match(ensureRegistrationNumber(bad), /^SC27-[0-9A-Z]{8}$/);
  }
});
