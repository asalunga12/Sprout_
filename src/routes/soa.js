// SOA routes:
//   POST /api/soa            -> create SOA from a request, email it, sync HubSpot
//   GET  /api/soa/:tracking  -> fetch a stored SOA (JSON)
//   GET  /api/soa/:tracking/pdf -> download the SOA PDF
//   POST /api/soa/preview    -> compute pricing only (no email/side effects)
import express from 'express';
import { store } from '../lib/store.js';
import { generateSOA } from '../services/soaGenerator.js';
import { calculatePricing } from '../services/pricing.js';
import { renderSOAPdf } from '../services/pdf.js';
import { sendMail } from '../services/email.js';
import { syncRegistration } from '../services/hubspot.js';
import {
  soaEmailHtml,
  soaEmailText,
  soaEmailSubject,
} from '../templates/soaEmail.js';
import {
  isEmail,
  normaliseRegistrants,
  required,
  ValidationError,
} from '../lib/validate.js';

const router = express.Router();

function parseSoaRequest(body) {
  const missing = required(body, [
    'company',
    'requestorName',
    'requestorEmail',
    'registrationType',
  ]);
  if (missing.length) {
    throw new ValidationError(`Missing required fields: ${missing.join(', ')}`, { missing });
  }
  if (!isEmail(body.requestorEmail)) {
    throw new ValidationError('requestorEmail is not a valid email address');
  }
  const registrants = normaliseRegistrants(body.registrants);
  const isIndividual = body.registrationType === 'individual';
  if (isIndividual && !registrants.length) {
    throw new ValidationError('At least one registrant is required for individual registration');
  }

  return {
    billTo: {
      company: body.company,
      address: body.address || '',
      tin: body.tin || '',
    },
    requestor: { name: body.requestorName, email: body.requestorEmail },
    customerType: body.customerType === 'client' ? 'client' : 'prospect',
    registrants,
    registrationType: body.registrationType,
    quantity: body.quantity !== undefined ? Number(body.quantity) : undefined,
    vatExempt: !!body.vatExempt,
    discountCode: body.discountCode || undefined,
    forceEarlyBird:
      typeof body.forceEarlyBird === 'boolean' ? body.forceEarlyBird : undefined,
  };
}

// Preview pricing only — no persistence, email, or HubSpot side effects.
router.post('/preview', (req, res, next) => {
  try {
    const parsed = parseSoaRequest(req.body || {});
    const quantity =
      parsed.quantity ??
      (parsed.registrationType === 'individual' ? parsed.registrants.length : 1);
    const pricing = calculatePricing({
      registrationType: parsed.registrationType,
      quantity,
      vatExempt: parsed.vatExempt,
      discountCode: parsed.discountCode,
      forceEarlyBird: parsed.forceEarlyBird,
    });
    res.json({ ok: true, pricing });
  } catch (e) {
    next(e);
  }
});

// Create + issue an SOA.
router.post('/', async (req, res, next) => {
  try {
    const parsed = parseSoaRequest(req.body || {});
    const soa = generateSOA(parsed);

    // Render PDF.
    const pdf = await renderSOAPdf(soa);

    // Sync HubSpot (contacts + deal). Capture ids for later payment update.
    const hs = await syncRegistration(soa);
    soa.hubspot = { dealId: hs.dealId, contactIds: hs.contactIds, dryRun: hs.dryRun };

    // Persist BEFORE emailing so a mail failure doesn't lose the record.
    store.insert('soa', soa);

    // Email the requestor with the PDF attached.
    const mail = await sendMail({
      to: soa.requestor.email,
      subject: soaEmailSubject(soa),
      html: soaEmailHtml(soa),
      text: soaEmailText(soa),
      attachments: [
        {
          filename: `SOA-${soa.invoiceNumber}.pdf`,
          content: pdf,
          contentType: 'application/pdf',
        },
      ],
    });
    store.update('soa', (s) => s.trackingNumber === soa.trackingNumber, {
      email: { mode: mail.mode, delivered: mail.delivered, ref: mail.ref },
    });

    res.status(201).json({
      ok: true,
      trackingNumber: soa.trackingNumber,
      invoiceNumber: soa.invoiceNumber,
      registrantCount: soa.registrants.length,
      pricing: soa.pricing,
      checkout: soa.checkout,
      email: { to: soa.requestor.email, mode: mail.mode, delivered: mail.delivered },
      hubspot: soa.hubspot,
      pdfUrl: `/api/soa/${soa.trackingNumber}/pdf`,
    });
  } catch (e) {
    next(e);
  }
});

router.get('/:tracking', (req, res, next) => {
  try {
    const soa = store.find('soa', (s) => s.trackingNumber === req.params.tracking);
    if (!soa) {
      res.status(404).json({ error: 'SOA not found' });
      return;
    }
    res.json(soa);
  } catch (e) {
    next(e);
  }
});

router.get('/:tracking/pdf', async (req, res, next) => {
  try {
    const soa = store.find('soa', (s) => s.trackingNumber === req.params.tracking);
    if (!soa) {
      res.status(404).json({ error: 'SOA not found' });
      return;
    }
    const pdf = await renderSOAPdf(soa);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="SOA-${soa.invoiceNumber}.pdf"`
    );
    res.send(pdf);
  } catch (e) {
    next(e);
  }
});

export default router;
