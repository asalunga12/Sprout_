// Tiny, dependency-free JSON persistence. Each "collection" is a single JSON
// file under DATA_DIR. Fine for the volume of an event; swap for a real DB
// (Postgres, Airtable, etc.) behind the same read/write/update calls later.
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../../config/env.js';

const DATA_DIR = path.resolve(env('DATA_DIR', './data'));

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function fileFor(collection) {
  return path.join(DATA_DIR, `${collection}.json`);
}

function readAll(collection) {
  const f = fileFor(collection);
  if (!fs.existsSync(f)) return [];
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return [];
  }
}

function writeAll(collection, rows) {
  ensureDir();
  fs.writeFileSync(fileFor(collection), JSON.stringify(rows, null, 2));
}

export const store = {
  all: (collection) => readAll(collection),

  find: (collection, predicate) => readAll(collection).find(predicate),

  insert: (collection, record) => {
    const rows = readAll(collection);
    rows.push(record);
    writeAll(collection, rows);
    return record;
  },

  update: (collection, predicate, patch) => {
    const rows = readAll(collection);
    const idx = rows.findIndex(predicate);
    if (idx === -1) return null;
    rows[idx] = { ...rows[idx], ...patch, updatedAt: new Date().toISOString() };
    writeAll(collection, rows);
    return rows[idx];
  },
};

// --- ID helpers ---
let seq = Date.now() % 100000;

/** Short numeric tracking number, like the sample SOA's "TRACKING#: 797". */
export function nextTrackingNumber() {
  // Persist a monotonic counter so tracking numbers don't repeat across restarts.
  const counter = store.find('_counters', (c) => c.name === 'tracking');
  const next = (counter?.value ?? 100) + 1;
  if (counter) {
    store.update('_counters', (c) => c.name === 'tracking', { value: next });
  } else {
    store.insert('_counters', { name: 'tracking', value: next });
  }
  return String(next);
}

/** Invoice number in the sample's "INV-<digits>" shape. */
export function nextInvoiceNumber() {
  seq += 1;
  const stamp = `${Date.now()}${seq}`.slice(-13);
  return `INV-${stamp}`;
}
