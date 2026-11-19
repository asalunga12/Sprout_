// Request for Sales Invoice (Official Receipt) — PARKED MODULE.
//
// Based on the SaaScon "Request for Sales Invoice" Google Form. This router is
// intentionally NOT mounted in src/server.js and NOT connected to any
// downstream service yet (no HubSpot sync, no email, no storage, no
// sales-invoice service). It only parses + validates the request and echoes a
// dry-run response, so the shape is ready the moment we wire it.
//
// TO WIRE IT LATER (when we know what leads here):
//   1. Add a multipart parser for the "proof of payment" upload. The public
//      page posts multipart/form-data (fields + a `proof` file). Express's
//      express.json() does NOT parse that — add multer/busboy (a new dep) and
//      mount this with it, e.g.:
//          import multer from 'multer';
//          const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } });
//          app.use('/api/invoice-request', upload.single('proof'), invoiceRequestRouter);
//      Then req.file holds the upload and req.body the text fields.
//   2. Decide the destination for the proof file (Drive folder / object store).
//   3. Connect the side effects: notify finance, create the sales-invoice
//      request, and/or sync to HubSpot — reuse src/services as needed.
import express from 'express';
import { isEmail, required, ValidationError } from '../lib/validate.js';

const router = express.Router();

// Allowed modes mirror the Google Form (plus free-text "Other: ...").
const PAYMENT_MODES = [
  'GCash',
  'Maya',
  'BPI',
  'UnionBank',
  'Credit Card/ Debit Card',
];

/** Validate + normalise an invoice-request body. Pure — no side effects. */
export function parseInvoiceRequest(body = {}) {
  const missing = required(body, [
    'email',
    'mode',
    'amountPaid',
    'referenceNumber',
    'registrantCount',
    'registrants',
    'sproutClient',
    'company',
    'address',
    'tin',
  ]);
  if (missing.length) {
    throw new ValidationError(`Missing required fields: ${missing.join(', ')}`, { missing });
  }
  if (!isEmail(body.email)) {
    throw new ValidationError('email is not a valid email address');
  }
  const mode = String(body.mode).trim();
  const modeOk = PAYMENT_MODES.includes(mode) || /^Other:\s*\S/.test(mode);
  if (!modeOk) {
    throw new ValidationError('mode must be one of the listed payment methods or "Other: <detail>"');
  }
  const count = Number(body.registrantCount);
  if (!Number.isFinite(count) || count < 1) {
    throw new ValidationError('registrantCount must be a number >= 1');
  }
  const sproutClient = String(body.sproutClient).trim();
  if (!/^(yes|no)$/i.test(sproutClient)) {
    throw new ValidationError('sproutClient must be "Yes" or "No"');
  }

  return {
    email: String(body.email).trim(),
    mode,
    orderId: body.orderId ? String(body.orderId).trim() : '',
    amountPaid: String(body.amountPaid).trim(),
    referenceNumber: String(body.referenceNumber).trim(),
    registrantCount: count,
    registrants: String(body.registrants).trim(),
    sproutClient: /^yes$/i.test(sproutClient) ? 'Yes' : 'No',
    company: String(body.company).trim(),
    address: String(body.address).trim(),
    tin: String(body.tin).trim(),
  };
}

// POST /  -> validate and acknowledge (dry-run; no side effects yet).
router.post('/', (req, res, next) => {
  try {
    const parsed = parseInvoiceRequest(req.body || {});
    // The uploaded proof lives on req.file once a multipart parser is mounted.
    const proof = req.file
      ? { filename: req.file.originalname, size: req.file.size, mimetype: req.file.mimetype }
      : null;
    res.status(202).json({
      ok: true,
      dryRun: true,
      parked: true,
      message:
        'Invoice-request module is parked — request validated but not yet processed.',
      request: parsed,
      proof,
    });
  } catch (e) {
    next(e);
  }
});

export default router;
