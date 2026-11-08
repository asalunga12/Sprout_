// POST /api/registrations — capture a registration (individual OR group) and
// sync it to HubSpot (attendee contacts tagged with the event; a deal for
// groups). This is the registration front-door, standalone from SOA issuance.
import express from 'express';
import { store } from '../lib/store.js';
import { isEmail, normaliseRegistrants, ValidationError } from '../lib/validate.js';
import { syncRegistration } from '../services/hubspot.js';
import { submitRegistrationToForm } from '../services/hubspotForm.js';
import { event } from '../../config/event.js';

const router = express.Router();

function relToCustomerType(rel) {
  return rel === 'client' || rel === 'sprout' ? 'client' : 'nonclient';
}

router.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    const kind = body.kind === 'individual' ? 'individual' : 'group';
    const customerType = relToCustomerType(body.rel || body.customerType);

    let record;
    if (kind === 'individual') {
      // Single attendee registering themselves.
      if (!body.name) throw new ValidationError('name is required');
      if (!isEmail(body.email)) throw new ValidationError('A valid email is required');
      record = {
        id: `REG-${Date.now()}`,
        createdAt: new Date().toISOString(),
        kind,
        event: { name: event.name, code: event.code },
        customerType,
        company: body.company || '',
        contacts: [
          {
            name: body.name,
            email: body.email,
            title: body.title || '',
            company: body.company || '',
            mobile: body.mobile || '',
          },
        ],
        registrantCount: 1,
        paymentStatus: 'Pending',
      };
    } else {
      // Group: a coordinator registers several attendees.
      const company = body.company;
      const rname = body.rname || body.requestorName;
      const remail = body.remail || body.requestorEmail;
      if (!company) throw new ValidationError('company is required');
      if (!rname) throw new ValidationError('coordinator name is required');
      if (!isEmail(remail)) throw new ValidationError('A valid coordinator email is required');
      const registrants = normaliseRegistrants(body.registrants);
      if (!registrants.length) {
        throw new ValidationError('At least one attendee is required');
      }
      record = {
        id: `REG-${Date.now()}`,
        createdAt: new Date().toISOString(),
        kind,
        event: { name: event.name, code: event.code },
        customerType,
        company,
        billTo: { company, address: body.address || '', tin: body.tin || '' },
        requestor: { name: rname, email: remail },
        registrants,
        registrantCount: registrants.length,
        paymentStatus: 'Pending',
      };
    }

    store.insert('registrations', record);

    // Primary path: submit each attendee to the HubSpot form (one submission
    // per contact). Dry-run unless HUBSPOT_FORM_SUBMIT=true.
    const formContacts =
      kind === 'individual'
        ? record.contacts
        : record.registrants.map((r) => ({ ...r, company: record.company }));
    const form = await submitRegistrationToForm(formContacts, {
      pageName: `${event.name} Registration`,
    });

    // Optional secondary path: tag contacts via the CRM API (no-op without
    // HUBSPOT_TOKEN).
    const hubspot = await syncRegistration(record);

    res.status(201).json({
      ok: true,
      registrationId: record.id,
      kind,
      registrantCount: record.registrantCount,
      form,
      hubspot,
    });
  } catch (e) {
    next(e);
  }
});

export default router;
