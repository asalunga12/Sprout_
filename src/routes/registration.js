// POST /api/registrations — capture a group registration and sync it to
// HubSpot (contacts + a deal). This is the "collect registrations for groups
// and connect it to HubSpot" step, standalone from SOA issuance.
import express from 'express';
import { store } from '../lib/store.js';
import { isEmail, normaliseRegistrants, required, ValidationError } from '../lib/validate.js';
import { syncRegistration } from '../services/hubspot.js';
import { event } from '../../config/event.js';

const router = express.Router();

router.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    const missing = required(body, ['company', 'requestorName', 'requestorEmail']);
    if (missing.length) {
      throw new ValidationError(`Missing required fields: ${missing.join(', ')}`, { missing });
    }
    if (!isEmail(body.requestorEmail)) {
      throw new ValidationError('requestorEmail is not a valid email address');
    }
    const registrants = normaliseRegistrants(body.registrants);
    if (!registrants.length) {
      throw new ValidationError('At least one registrant is required');
    }

    const record = {
      id: `REG-${Date.now()}`,
      createdAt: new Date().toISOString(),
      event: { name: event.name, code: event.code },
      billTo: {
        company: body.company,
        address: body.address || '',
        tin: body.tin || '',
      },
      requestor: { name: body.requestorName, email: body.requestorEmail },
      customerType: body.customerType === 'client' ? 'client' : 'prospect',
      registrants,
      registrantCount: registrants.length,
      paymentStatus: 'Unpaid',
    };
    store.insert('registrations', record);

    // Sync to HubSpot (dry-run if no token).
    const hs = await syncRegistration({
      ...record,
      pricing: { total: 0 },
      invoiceNumber: '(pending SOA)',
      trackingNumber: '(pending SOA)',
    });

    res.status(201).json({
      ok: true,
      registrationId: record.id,
      registrantCount: record.registrantCount,
      hubspot: hs,
    });
  } catch (e) {
    next(e);
  }
});

export default router;
