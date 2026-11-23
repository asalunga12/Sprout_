// POST /api/registrations — capture a registration (individual OR group) and
// sync it to HubSpot (attendee contacts tagged with the event; a deal for
// groups). This is the registration front-door, standalone from SOA issuance.
import crypto from 'node:crypto';
import express from 'express';
import { env } from '../../config/env.js';
import { store } from '../lib/store.js';
import { isEmail, normaliseRegistrants, ValidationError } from '../lib/validate.js';
import { syncRegistration } from '../services/hubspot.js';
import { submitRegistrationToForm } from '../services/hubspotForm.js';
import { registrationTypeValue, eventLeadStatusValue } from '../../config/hubspot.js';
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

// GET / — list recorded registrations for the admin view. If ADMIN_TOKEN is
// set, a matching `x-admin-token` header or `?token=` is required (registration
// rows contain attendee PII). Without ADMIN_TOKEN the list is open (dev/demo).
router.get('/', (req, res, next) => {
  try {
    const needed = env('ADMIN_TOKEN');
    if (needed && (req.get('x-admin-token') || req.query.token) !== needed) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const rows = store.all('registrations');
    const registrations = rows
      .slice()
      .reverse()
      .map((r) => ({
        registrationNumber: r.registrationNumber || '',
        id: r.id,
        kind: r.kind,
        customerType: r.customerType,
        company: r.company || '',
        contactName:
          r.kind === 'individual' ? r.contacts?.[0]?.name || '' : r.requestor?.name || '',
        contactEmail:
          r.kind === 'individual' ? r.contacts?.[0]?.email || '' : r.requestor?.email || '',
        companyHeadcount: r.companyHeadcount ?? '',
        registrantCount: r.registrantCount ?? 0,
        tables: r.tables ?? null,
        eventRegistrationType: r.eventRegistrationType || '',
        eventLeadStatus: r.eventLeadStatus || '',
        paymentStatus: r.paymentStatus || 'Pending',
        createdAt: r.createdAt,
      }));
    res.json({ ok: true, count: registrations.length, registrations });
  } catch (e) {
    next(e);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    const kind = ['individual', 'table'].includes(body.kind) ? body.kind : 'group';
    const customerType = relToCustomerType(body.rel || body.customerType);
    const registrationNumber = ensureRegistrationNumber(body.registrationNumber);
    // Company headcount is entered on the form and pushed to HubSpot's
    // `headcount` property. Blank/invalid -> not pushed.
    const companyHeadcount = Number(body.companyHeadcount) > 0 ? Number(body.companyHeadcount) : '';

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

    record.registrationNumber = registrationNumber;
    record.companyHeadcount = companyHeadcount;
    record.eventRegistrationType = registrationTypeValue({ kind, customerType });
    record.eventLeadStatus = eventLeadStatusValue({ customerType });
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
    // Push the company headcount, event registration type and event lead status
    // onto every attendee contact (HubSpot `headcount`,
    // `event_registration_type`, `marketing_lead_status`).
    const contactsForForm = formContacts.map((c) => ({
      ...c,
      headcount: companyHeadcount,
      eventRegistrationType: record.eventRegistrationType,
      eventLeadStatus: record.eventLeadStatus,
    }));
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
