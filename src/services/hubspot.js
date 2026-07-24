// HubSpot adapter (CRM API v3/v4 over fetch — no SDK dependency).
//
// Responsibilities:
//   - Upsert the requestor + each registrant as Contacts.
//   - Create a Deal representing the group registration, associated to the
//     requestor contact, tagged with the event and SOA identifiers.
//   - Update the "Event Payment Status" property when payment lands.
//
// If HUBSPOT_TOKEN is not set, every call is a no-op that logs what WOULD have
// happened (dry-run), so the rest of the pipeline still works end-to-end.
import { env } from '../../config/env.js';
import { event } from '../../config/event.js';

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
async function upsertContact({ email, name, extraProps = {} }) {
  const [firstname, ...rest] = (name || '').trim().split(/\s+/);
  const properties = {
    email,
    ...(firstname ? { firstname } : {}),
    ...(rest.length ? { lastname: rest.join(' ') } : {}),
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
 * Sync a group registration / SOA into HubSpot.
 * @param {object} soa  the generated SOA record
 * @returns {Promise<{ dealId, contactIds, dryRun }>}
 */
export async function syncRegistration(soa) {
  const statusProp = env('HUBSPOT_PAYMENT_STATUS_PROPERTY', 'event_payment_status');
  const statusObject = env('HUBSPOT_PAYMENT_STATUS_OBJECT', 'deal');

  if (!isConfigured()) {
    console.warn(
      `[hubspot] DRY-RUN — would upsert requestor + ${soa.registrants.length} registrant(s), ` +
        `create deal "${soa.event.name} — ${soa.billTo.company}" (${soa.invoiceNumber}), ` +
        `set ${statusProp}="${soa.paymentStatus}".`
    );
    return { dryRun: true, dealId: null, contactIds: [] };
  }

  // 1) Upsert requestor + registrants as contacts.
  const contactInputs = [
    { email: soa.requestor.email, name: soa.requestor.name },
    ...soa.registrants.filter((r) => r.email),
  ].filter((c) => c.email);

  const contactIds = [];
  for (const c of contactInputs) {
    try {
      const id = await upsertContact({
        email: c.email,
        name: c.name,
        extraProps: { [`${statusProp}`]: statusObject === 'contact' ? soa.paymentStatus : undefined },
      });
      contactIds.push(id);
    } catch (e) {
      console.error(`[hubspot] contact upsert failed for ${c.email}: ${e.message}`);
    }
  }

  // 2) Create a deal for the group.
  const dealProps = {
    dealname: `${soa.event.name} — ${soa.billTo.company || soa.requestor.name}`,
    amount: String(soa.pricing.total),
    ...(env('HUBSPOT_DEAL_PIPELINE') ? { pipeline: env('HUBSPOT_DEAL_PIPELINE') } : {}),
    ...(env('HUBSPOT_DEAL_STAGE') ? { dealstage: env('HUBSPOT_DEAL_STAGE') } : {}),
    // Custom properties (create these in HubSpot or they are ignored/errored):
    event_name: soa.event.name,
    soa_invoice_number: soa.invoiceNumber,
    soa_tracking_number: soa.trackingNumber,
    ...(statusObject === 'deal' ? { [statusProp]: soa.paymentStatus } : {}),
  };

  let dealId = null;
  try {
    const deal = await hsFetch('/crm/v3/objects/deals', {
      method: 'POST',
      body: { properties: dealProps },
    });
    dealId = deal.id;
    // Associate the requestor (first contact) to the deal.
    if (contactIds[0]) await associateContactToDeal(dealId, contactIds[0]);
  } catch (e) {
    // Retry without custom props in case they don't exist in the portal yet.
    console.error(`[hubspot] deal create failed (${e.message}); retrying minimal.`);
    try {
      const deal = await hsFetch('/crm/v3/objects/deals', {
        method: 'POST',
        body: {
          properties: {
            dealname: dealProps.dealname,
            amount: dealProps.amount,
          },
        },
      });
      dealId = deal.id;
      if (contactIds[0]) await associateContactToDeal(dealId, contactIds[0]);
    } catch (e2) {
      console.error(`[hubspot] deal create retry failed: ${e2.message}`);
    }
  }

  return { dryRun: false, dealId, contactIds };
}

/**
 * Update the "Event Payment Status" property once payment is confirmed.
 * @param {object} opts
 * @param {string} [opts.dealId]
 * @param {string} [opts.contactEmail]
 * @param {string} opts.status  e.g. "Paid"
 */
export async function updatePaymentStatus({ dealId, contactEmail, status }) {
  const statusProp = env('HUBSPOT_PAYMENT_STATUS_PROPERTY', 'event_payment_status');
  const statusObject = env('HUBSPOT_PAYMENT_STATUS_OBJECT', 'deal');

  if (!isConfigured()) {
    console.warn(
      `[hubspot] DRY-RUN — would set ${statusProp}="${status}" on ${statusObject} ` +
        `(deal=${dealId ?? '-'}, contact=${contactEmail ?? '-'}).`
    );
    return { dryRun: true };
  }

  try {
    if (statusObject === 'deal' && dealId) {
      await hsFetch(`/crm/v3/objects/deals/${dealId}`, {
        method: 'PATCH',
        body: { properties: { [statusProp]: status } },
      });
      return { dryRun: false, updated: 'deal', id: dealId };
    }
    if (statusObject === 'contact' && contactEmail) {
      const id = await findContactByEmail(contactEmail);
      if (id) {
        await hsFetch(`/crm/v3/objects/contacts/${id}`, {
          method: 'PATCH',
          body: { properties: { [statusProp]: status } },
        });
        return { dryRun: false, updated: 'contact', id };
      }
    }
    console.warn('[hubspot] updatePaymentStatus: no target id resolved.');
    return { dryRun: false, updated: null };
  } catch (e) {
    console.error(`[hubspot] updatePaymentStatus failed: ${e.message}`);
    return { dryRun: false, error: e.message };
  }
}
