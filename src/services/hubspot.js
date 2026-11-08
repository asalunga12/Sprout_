// HubSpot adapter (CRM API v3/v4 over fetch — no SDK dependency).
//
// Registration data lives on CONTACTS (one per attendee), tagged with the
// event via the portal's real properties:
//   event_name, event_registration_type, event_payment_status, jobtitle.
// A Deal is also created for group/SOA registrations (pipeline + amount),
// with the coordinator associated.
//
// If HUBSPOT_TOKEN is not set, every call is a no-op that logs what WOULD have
// happened (dry-run), so the rest of the pipeline still works end-to-end.
import { env } from '../../config/env.js';
import {
  hubspotProps,
  PAYMENT_STATUS,
  contactEventProps,
  registrationTypeValue,
} from '../../config/hubspot.js';

const BASE = 'https://api.hubapi.com';

function token() {
  return env('HUBSPOT_TOKEN');
}

export function isConfigured() {
  return !!token();
}

async function hsFetch(pathname, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${token()}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = new Error(
      `HubSpot ${method} ${pathname} -> ${res.status}: ${json.message || text}`
    );
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

/** Find a contact id by email, or null. */
async function findContactByEmail(email) {
  const json = await hsFetch('/crm/v3/objects/contacts/search', {
    method: 'POST',
    body: {
      filterGroups: [
        { filters: [{ propertyName: 'email', operator: 'EQ', value: email }] },
      ],
      properties: ['email'],
      limit: 1,
    },
  });
  return json.results?.[0]?.id ?? null;
}

/** Create or update a contact by email; returns its id. */
async function upsertContact({ email, name, title, company, extraProps = {} }) {
  const [firstname, ...rest] = (name || '').trim().split(/\s+/);
  const properties = {
    email,
    ...(firstname ? { firstname } : {}),
    ...(rest.length ? { lastname: rest.join(' ') } : {}),
    ...(title ? { [hubspotProps.jobTitle]: title } : {}),
    ...(company ? { company } : {}),
    ...extraProps,
  };
  const existing = await findContactByEmail(email);
  if (existing) {
    await hsFetch(`/crm/v3/objects/contacts/${existing}`, {
      method: 'PATCH',
      body: { properties },
    });
    return existing;
  }
  const created = await hsFetch('/crm/v3/objects/contacts', {
    method: 'POST',
    body: { properties },
  });
  return created.id;
}

/** Associate a contact to a deal (v4 default association). */
async function associateContactToDeal(dealId, contactId) {
  await hsFetch(
    `/crm/v4/objects/deals/${dealId}/associations/default/contacts/${contactId}`,
    { method: 'PUT' }
  );
}

/**
 * Normalise any registration/SOA shape into the fields we need.
 * Accepts the SOA record (requestor + registrants + billTo + registrationType)
 * or a front-door registration ({ kind, contacts, company, customerType }).
 */
function normalise(reg) {
  const eventName = reg.event?.name ?? reg.eventName;
  const customerType = reg.customerType === 'client' ? 'client' : 'nonclient';
  const registrationType = reg.registrationType; // individual|tablePublic|tableClient|undefined
  const kind =
    reg.kind ||
    (['tablePublic', 'tableClient'].includes(registrationType)
      ? 'group'
      : registrationType === 'individual'
        ? 'individual'
        : 'group');
  const paid =
    typeof reg.paid === 'boolean' ? reg.paid : reg.paymentStatus === 'Paid';
  const company = reg.company ?? reg.billTo?.company ?? '';

  // Everyone who should become a contact.
  let contacts = reg.contacts;
  if (!contacts) {
    const list = [];
    if (reg.requestor?.email) {
      list.push({
        name: reg.requestor.name,
        email: reg.requestor.email,
        title: reg.requestor.title,
        coordinator: true,
      });
    }
    for (const r of reg.registrants || []) {
      if (r.email && r.email !== reg.requestor?.email) {
        list.push({ name: r.name, email: r.email, title: r.title });
      }
    }
    contacts = list;
  }
  contacts = contacts
    .filter((c) => c.email)
    .map((c) => ({ ...c, company: c.company ?? company }));

  return { eventName, customerType, registrationType, kind, paid, company, contacts, reg };
}

/**
 * Sync a registration (individual or group) into HubSpot.
 * Upserts every attendee as a contact tagged with the event, and — for group
 * registrations with pricing — also creates a deal.
 * @returns {Promise<{ dryRun:boolean, contactIds:string[], dealId:string|null, registrationType:string }>}
 */
export async function syncRegistration(reg) {
  const n = normalise(reg);
  const regTypeValue = registrationTypeValue({
    kind: n.kind,
    registrationType: n.registrationType,
    customerType: n.customerType,
  });

  if (!isConfigured()) {
    console.warn(
      `[hubspot] DRY-RUN — would upsert ${n.contacts.length} contact(s) for "${n.eventName}" ` +
        `with ${hubspotProps.registrationType}="${regTypeValue}", ` +
        `${hubspotProps.paymentStatus}="${n.paid ? PAYMENT_STATUS.paid : PAYMENT_STATUS.unpaid}".`
    );
    return { dryRun: true, contactIds: [], dealId: null, registrationType: regTypeValue };
  }

  const eventProps = contactEventProps({
    eventName: n.eventName,
    kind: n.kind,
    registrationType: n.registrationType,
    customerType: n.customerType,
    paid: n.paid,
  });

  // 1) Upsert every attendee as a contact carrying the event properties.
  const contactIds = [];
  for (const c of n.contacts) {
    try {
      const id = await upsertContact({
        email: c.email,
        name: c.name,
        title: c.title,
        company: c.company,
        extraProps: eventProps,
      });
      contactIds.push(id);
    } catch (e) {
      console.error(`[hubspot] contact upsert failed for ${c.email}: ${e.message}`);
    }
  }

  // 2) For group/SOA registrations with an amount, also create a deal.
  let dealId = null;
  const total = n.reg.pricing?.total;
  if (n.kind === 'group' && total !== undefined) {
    const dealProps = {
      dealname: `${n.eventName} — ${n.company || n.contacts[0]?.name || 'Group'}`,
      amount: String(total),
      ...(env('HUBSPOT_DEAL_PIPELINE') ? { pipeline: env('HUBSPOT_DEAL_PIPELINE') } : {}),
      ...(env('HUBSPOT_DEAL_STAGE') ? { dealstage: env('HUBSPOT_DEAL_STAGE') } : {}),
    };
    try {
      const deal = await hsFetch('/crm/v3/objects/deals', {
        method: 'POST',
        body: { properties: dealProps },
      });
      dealId = deal.id;
      if (contactIds[0]) await associateContactToDeal(dealId, contactIds[0]);
    } catch (e) {
      console.error(`[hubspot] deal create failed: ${e.message}`);
    }
  }

  return { dryRun: false, contactIds, dealId, registrationType: regTypeValue };
}

/**
 * Update "Event Payment Status" to Paid once payment is confirmed. Updates the
 * attendee contacts (where the property lives) and, if given, the deal too.
 * @param {object} opts
 * @param {string[]} [opts.contactEmails]  attendee emails to mark paid
 * @param {string}   [opts.contactEmail]   single email (convenience)
 * @param {string}   [opts.dealId]
 * @param {boolean}  [opts.paid=true]
 */
export async function updatePaymentStatus({
  contactEmails,
  contactEmail,
  dealId,
  paid = true,
}) {
  const value = paid ? PAYMENT_STATUS.paid : PAYMENT_STATUS.unpaid;
  const emails = contactEmails || (contactEmail ? [contactEmail] : []);

  if (!isConfigured()) {
    console.warn(
      `[hubspot] DRY-RUN — would set ${hubspotProps.paymentStatus}="${value}" on ` +
        `${emails.length} contact(s)${dealId ? ` + deal ${dealId}` : ''}.`
    );
    return { dryRun: true };
  }

  const updated = { contacts: 0, deal: null };
  for (const email of emails) {
    try {
      const id = await findContactByEmail(email);
      if (id) {
        await hsFetch(`/crm/v3/objects/contacts/${id}`, {
          method: 'PATCH',
          body: { properties: { [hubspotProps.paymentStatus]: value } },
        });
        updated.contacts += 1;
      }
    } catch (e) {
      console.error(`[hubspot] payment-status update failed for ${email}: ${e.message}`);
    }
  }
  if (dealId) {
    try {
      await hsFetch(`/crm/v3/objects/deals/${dealId}`, {
        method: 'PATCH',
        body: { properties: { [hubspotProps.paymentStatus]: value } },
      });
      updated.deal = dealId;
    } catch (e) {
      console.error(`[hubspot] deal payment-status update failed: ${e.message}`);
    }
  }
  return { dryRun: false, ...updated };
}
