// Lightweight request validation helpers (no external schema library).

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmail(v) {
  return typeof v === 'string' && EMAIL_RE.test(v.trim());
}

export function required(obj, fields) {
  const missing = fields.filter(
    (f) => obj[f] === undefined || obj[f] === null || obj[f] === ''
  );
  return missing;
}

/**
 * Normalise a list of registrants. Accepts either an array of
 * { name, email } objects or arrays of parallel name/email fields.
 */
export function normaliseRegistrants(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map((r) => ({
      name: String(r?.name ?? '').trim(),
      email: String(r?.email ?? '').trim(),
    }))
    .filter((r) => r.name || r.email);
}

export class ValidationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = 400;
    this.details = details;
  }
}
