// HubSpot Forms Submission API adapter.
//
// Submits a registrant to a HubSpot form via the public v3 "integration"
// endpoint. This needs NO private-app token — the portal id + form GUID are
// the submit coordinates — and it triggers the form's own follow-up workflows
// and notifications, exactly like a real form fill.
//
// IMPORTANT: a HubSpot form only accepts fields that exist ON that form. The
// FIELD_MAP below maps our registration inputs to standard contact field
// internal names; adjust it to match the form's actual fields.
//
// Submission is a DRY-RUN by default (logs the payload). Set
// HUBSPOT_FORM_SUBMIT=true to post real submissions to the live form.
import { env, envBool } from '../../config/env.js';

const PORTAL = env('HUBSPOT_PORTAL_ID', '2500439');
const FORM_GUID = env('HUBSPOT_FORM_GUID', '790deae5-8808-4d25-b641-0dd91afa7b2d');

export function isFormConfigured() {
  return !!(PORTAL && FORM_GUID);
}

function splitName(name = '') {
  const [firstname, ...rest] = String(name).trim().split(/\s+/);
  return { firstname: firstname || '', lastname: rest.join(' ') };
}

// contact field -> HubSpot form field internal name.
const FIELD_MAP = {
  email: 'email',
  firstname: 'firstname',
  lastname: 'lastname',
  title: 'jobtitle',
  company: 'company',
  mobile: 'mobilephone',
};

/** Build the HubSpot form `fields` array for one attendee (objectTypeId 0-1 = contact). */
export function buildFields(contact) {
  const { firstname, lastname } = splitName(contact.name);
  const values = {
    email: contact.email,
    firstname,
    lastname,
    title: contact.title,
    company: contact.company,
    mobile: contact.mobile,
  };
  return Object.entries(values)
    .filter(([, v]) => v != null && v !== '')
    .map(([key, value]) => ({
      objectTypeId: '0-1',
      name: FIELD_MAP[key],
      value: String(value),
    }));
}

/** Submit one attendee to the form. */
export async function submitToForm(contact, context = {}) {
  const fields = buildFields(contact);

  if (!envBool('HUBSPOT_FORM_SUBMIT', false)) {
    console.warn(
      `[hsform] DRY-RUN — would POST ${fields.length} field(s) to form ${FORM_GUID} ` +
        `for ${contact.email} (${fields.map((f) => f.name).join(', ')}).`
    );
    return { dryRun: true, email: contact.email, fields };
  }

  const url = `https://api.hsforms.com/submissions/v3/integration/submit/${PORTAL}/${FORM_GUID}`;
  const body = {
    fields,
    context: {
      pageUri: context.pageUri || 'registration',
      pageName: context.pageName || 'SaaScon PH 2027 Registration',
      ...(context.hutk ? { hutk: context.hutk } : {}),
    },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = new Error(`HubSpot form submit ${res.status}: ${json.message || text}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return { dryRun: false, ok: true, email: contact.email, response: json };
}

/** Submit a list of attendees; one submission per contact. */
export async function submitRegistrationToForm(contacts, context = {}) {
  const results = [];
  for (const c of contacts) {
    if (!c.email) continue;
    try {
      results.push(await submitToForm(c, context));
    } catch (e) {
      console.error(`[hsform] submit failed for ${c.email}: ${e.message}`);
      results.push({ ok: false, email: c.email, error: e.message });
    }
  }
  return results;
}
