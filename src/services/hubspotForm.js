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

// Optional UTM -> contact-property mapping. The Sprout portal has NO dedicated
// utm_* contact properties, so by default UTMs are reflected via HubSpot
// analytics (the UTM query string in `context.pageUri` + the `hubspotutk`
// cookie). If you later create utm properties and add them to the form, set the
// env vars below to also write them as explicit fields.
const UTM_PROPS = {
  utm_source: env('HUBSPOT_UTM_SOURCE_PROPERTY'),
  utm_medium: env('HUBSPOT_UTM_MEDIUM_PROPERTY'),
  utm_campaign: env('HUBSPOT_UTM_CAMPAIGN_PROPERTY'),
  utm_term: env('HUBSPOT_UTM_TERM_PROPERTY'),
  utm_content: env('HUBSPOT_UTM_CONTENT_PROPERTY'),
};

/** Build explicit UTM fields only for the params that have a configured property. */
export function buildUtmFields(utm = {}) {
  const fields = [];
  for (const [param, prop] of Object.entries(UTM_PROPS)) {
    if (prop && utm[param]) {
      fields.push({ objectTypeId: '0-1', name: prop, value: String(utm[param]) });
    }
  }
  return fields;
}

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

/** Ensure the pageUri carries the UTM query string (HubSpot attributes from it). */
export function pageUriWithUtm(pageUri, utm = {}) {
  const base = pageUri || 'https://register.sprout.ph/saascon-2027';
  const entries = Object.entries(utm || {}).filter(([, v]) => v);
  if (!entries.length || base.includes('?')) return base;
  const qs = entries
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return `${base}?${qs}`;
}

/** Submit one attendee to the form. */
export async function submitToForm(contact, context = {}) {
  // UTM attribution: HubSpot reads the UTM query string from `pageUri` and ties
  // the submission to the visitor via `hutk` (the hubspotutk cookie). Explicit
  // UTM fields are added only when configured (see UTM_PROPS).
  const fields = [...buildFields(contact), ...buildUtmFields(context.utm)];

  // Carry the landing URL's UTM query string into pageUri even if the caller
  // only passed the UTMs (so analytics attribution works without a full URL).
  const pageUri = pageUriWithUtm(context.pageUri, context.utm);

  if (!envBool('HUBSPOT_FORM_SUBMIT', false)) {
    console.warn(
      `[hsform] DRY-RUN — would POST ${fields.length} field(s) to form ${FORM_GUID} ` +
        `for ${contact.email} (${fields.map((f) => f.name).join(', ')}); ` +
        `pageUri=${pageUri}${context.hutk ? ' hutk=set' : ''}.`
    );
    return { dryRun: true, email: contact.email, fields, pageUri };
  }

  const url = `https://api.hsforms.com/submissions/v3/integration/submit/${PORTAL}/${FORM_GUID}`;
  const body = {
    fields,
    context: {
      pageUri,
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
