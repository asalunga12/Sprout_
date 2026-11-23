// POST /api/registrations — capture a registration (individual OR group) and
// sync it to HubSpot (attendee contacts tagged with the event; a deal for
// groups). This is the registration front-door, standalone from SOA issuance.
import crypto from 'node:crypto';
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

// --- Registration number (recorded in the `registrations` table, NOT HubSpot) ---
const REG_NUMBER_RE = /^SC27-[0-9A-Z]{8}$/;

/** A unique registration reference, e.g. SC27-7F3A9C2B. */
export function generateRegistrationNumber() {
  const t = Date.now().toString(36).toUpperCase();
  const r = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `SC27-${(t + r).slice(-8)}`;
}

/**
 * Settle the registration number server-side: accept the page's value when it
 * is well-formed and not already used, otherwise mint a fresh unique one. This
 * makes the backend table the authority on the number.
 */
export function ensureRegistrationNumber(candidate) {
  let num =
    typeof candidate === 'string' && REG_NUMBER_RE.test(candidate.trim())
      ? candidate.trim()
      : generateRegistrationNumber();
  for (let i = 0; i < 6 && store.find('registrations', (r) => r.registrationNumber === num); i++) {
    num = generateRegistrationNumber();
  }
  return num;
}

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
/** Pull the standard UTM params out of an object (body.utm or query-style body). */
function pickUtm(src = {}) {
  const out = {};
  for (const k of UTM_KEYS) {
    if (src[k] != null && src[k] !== '') out[k] = String(src[k]);
  }
  return out;
}

router.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    const kind = ['individual', 'table'].includes(body.kind) ? body.kind : 'group';
    const customerType = relToCustomerType(body.rel || body.customerType);
    const registrationNumber = ensureRegistrationNumber(body.registrationNumber);

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
        headcount: 1,
        paymentStatus: 'Pending',
      };
    } else if (kind === 'table') {
      // Table: a coordinator reserves one or more tables; attendees optional.
      const company = body.company;
      const rname = body.rname || body.requestorName;
      const remail = body.remail || body.requestorEmail;
      if (!company) throw new ValidationError('company is required');
      if (!rname) throw new ValidationError('coordinator name is required');
      if (!isEmail(remail)) throw new ValidationError('A valid coordinator email is required');
      const tables = Math.max(1, Number(body.tables) || 1);
      const registrants = normaliseRegistrants(body.registrants); // optional
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
        tables,
        registrantCount: registrants.length,
        headcount: tables * 10,
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
        headcount: registrants.length,
        paymentStatus: 'Pending',
      };
    }

    record.registrationNumber = registrationNumber;
    store.insert('registrations', record);

    // Primary path: submit each attendee to the HubSpot form (one submission
    // per contact). Dry-run unless HUBSPOT_FORM_SUBMIT=true.
    const formContacts =
      kind === 'individual'
        ? record.contacts
        : kind === 'table'
          ? [
              { name: record.requestor.name, email: record.requestor.email, company: record.company },
              ...record.registrants.map((r) => ({ ...r, company: record.company })),
            ]
          : record.registrants.map((r) => ({ ...r, company: record.company }));
    // Push the registration's headcount onto every attendee contact (HubSpot
    // `headcount` number property, configurable via HUBSPOT_HEADCOUNT_PROPERTY).
    const contactsForForm = formContacts.map((c) => ({ ...c, headcount: record.headcount }));
    // UTM / attribution forwarded from the landing page. HubSpot reflects UTMs
    // via the page URL + the hubspotutk cookie.
    const utm = pickUtm(body.utm || body);
    const form = await submitRegistrationToForm(contactsForForm, {
      pageName: `${event.name} Registration`,
      pageUri: body.pageUri,
      hutk: body.hutk,
      utm,
    });

    // Optional secondary path: tag contacts via the CRM API (no-op without
    // HUBSPOT_TOKEN).
    const hubspot = await syncRegistration(record);

    res.status(201).json({
      ok: true,
      registrationId: record.id,
      registrationNumber,
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
