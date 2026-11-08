// HubSpot field + value mapping, grounded in the Sprout portal's actual
// contact property schema (verified against the live portal):
//
//   event_name            (enumeration) — the event option must exist in HubSpot
//   event_registration_type (enumeration) — see REGISTRATION_TYPE_VALUES below
//   event_payment_status  (enumeration) — ONLY "Paid" / "Pending" exist
//   jobtitle              (string)      — standard HubSpot property
//
// Registration data is written to CONTACTS (one per attendee). Deals are
// optional/secondary (used by the SOA flow for pipeline + amount).
import { env } from './env.js';

export const hubspotProps = {
  eventName: env('HUBSPOT_EVENT_NAME_PROPERTY', 'event_name'),
  registrationType: env('HUBSPOT_REGISTRATION_TYPE_PROPERTY', 'event_registration_type'),
  paymentStatus: env('HUBSPOT_PAYMENT_STATUS_PROPERTY', 'event_payment_status'),
  jobTitle: env('HUBSPOT_JOBTITLE_PROPERTY', 'jobtitle'),
};

// event_payment_status only accepts these two values in the portal.
// (There is no "Unpaid" option — a new registration is "Pending".)
export const PAYMENT_STATUS = { unpaid: 'Pending', paid: 'Paid' };

// Valid event_registration_type options in the portal:
//   Individual Registration | Sprout Client Registration | Group Registration |
//   Group Registration - Client | Table Registration | Startup Founder
//
// Map our internal (kind, registrationType, customerType) to one of them.
export function registrationTypeValue({ kind, registrationType, customerType }) {
  const client = customerType === 'client';
  // SOA table registrations take precedence when a table type is given.
  if (registrationType === 'tablePublic' || registrationType === 'tableClient') {
    return 'Table Registration';
  }
  if (kind === 'individual' || registrationType === 'individual') {
    return client ? 'Sprout Client Registration' : 'Individual Registration';
  }
  // group
  return client ? 'Group Registration - Client' : 'Group Registration';
}

/** Build the contact event properties block written on every attendee. */
export function contactEventProps({
  eventName,
  kind,
  registrationType,
  customerType,
  paid = false,
}) {
  return {
    [hubspotProps.eventName]: eventName,
    [hubspotProps.registrationType]: registrationTypeValue({
      kind,
      registrationType,
      customerType,
    }),
    [hubspotProps.paymentStatus]: paid ? PAYMENT_STATUS.paid : PAYMENT_STATUS.unpaid,
  };
}
