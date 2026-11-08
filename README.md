# Sprout Event SOA Tool

Group-registration and **Statement of Account (SOA)** tool for Sprout Solutions
events (built for *State of HR Summit 2026 / KONEKTA*, reusable per event).

It does the full loop the marketing team asked for:

1. **Collect group registrations** and sync them to **HubSpot** (contacts + a deal).
2. **Collect SOA requests** with the required fields and **count the registrants per group**.
3. **Generate a Statement of Account** priced by **registrant count, VAT exemption,
   early-bird rate, and discount code**.
4. **Email the SOA** (styled HTML body **+ PDF attachment**) to the requestor.
5. Include a **Shopify checkout link customised to the requestor** — individual cart
   permalink pre-filled with the registrant count, or the client vs. general-public
   table-registration pages.
6. On **payment** (Shopify "order paid" webhook): raise a **sales-invoice request**
   and update the HubSpot **Event Payment Status** property to `Paid`.

Everything runs **without live credentials**: unconfigured integrations degrade to a
logged *dry-run* (HubSpot) or an `./outbox/*.eml` file (email), so you can develop
and demo the whole pipeline, then drop in secrets to go live.

---

## Quick start

```bash
npm install
cp .env.example .env        # optional — runs fine with defaults
npm start                   # http://localhost:3000
npm test                    # unit + integration tests
```

Open <http://localhost:3000> for the registration / SOA-request form (with a live
"Preview total" button).

## How the money is calculated

Unit prices in `config/pricing.js` are **VAT-inclusive** (matching the sample SOA's
"per registrant (VAT Inclusive)"). The engine (`src/services/pricing.js`) derives:

```
gross     = unitPrice × quantity − discount
subtotal  = gross ÷ 1.12          (net of VAT)
vat       = gross − subtotal       (the 12% portion; 0 when VAT-exempt)
total     = gross                  (VAT-exempt buyers pay `subtotal` instead)
```

- **Early bird** is chosen automatically from `event.earlyBirdCutoff`, or forced per request.
- **Discount codes** (`percent` / `fixed`) apply to the gross; each can be flagged
  non-stackable with early bird.
- **VAT-exempt** buyers have the 12% stripped (they pay the net subtotal).

> The rates in `config/pricing.js` are **placeholders** — replace them with your
> finalized numbers. The engine does not change.

## API

A live, deployable registration page is served at **`/registration.html`**
(individual + group). It captures UTM parameters and the `hubspotutk` cookie,
posts to `/api/registrations`, and submits each attendee to the HubSpot
"SaaScon PH 2027 Registration Form". The HubSpot tracking code is embedded in
its `<head>` so attribution works on a real host.

| Method & path | Purpose |
|---|---|
| `GET  /registration.html` | Live registration page (individual + group) → HubSpot. |
| `POST /api/soa/preview` | Compute pricing only (no side effects) — powers the form preview. |
| `POST /api/soa` | Create an SOA, sync HubSpot, email the PDF, return checkout link. |
| `GET  /api/soa/:tracking` | Fetch a stored SOA (JSON). |
| `GET  /api/soa/:tracking/pdf` | Download / view the SOA PDF. |
| `POST /api/registrations` | Capture a group registration into HubSpot (no SOA). |
| `POST /webhooks/shopify/order-paid` | Shopify payment webhook → invoice request + HubSpot `Paid`. |
| `GET  /healthz` | Health check. |

### Example: create an SOA

```bash
curl -X POST localhost:3000/api/soa -H 'Content-Type: application/json' -d '{
  "company": "KONEKTAO Global BPO Corporation",
  "tin": "010970942",
  "requestorName": "Jessa Jean Miranda",
  "requestorEmail": "hr@konektao.com",
  "customerType": "prospect",
  "registrationType": "individual",
  "registrants": [
    {"name": "Jessa Jean Miranda", "email": "hr@konektao.com"},
    {"name": "Kristine Claire Honrade", "email": "payroll@konektao.com"}
  ],
  "discountCode": "SPROUT10",
  "vatExempt": false
}'
```

`registrationType` is one of `individual`, `tablePublic`, `tableClient`.
For `individual`, quantity is inferred from the number of registrants; for table
types pass `quantity` (number of tables).

## Configuration

| File | What to edit |
|---|---|
| `config/event.js` | Seller/header details, event name + early-bird cutoff, Shopify links, bank accounts, payment notes. |
| `config/pricing.js` | Rates (regular + early bird) per registration type, VAT rate, discount codes. |
| `.env` | Secrets & wiring (SMTP, HubSpot token/property, Shopify webhook secret, invoice mode). See `.env.example`. |

### Going live — the three integrations

- **Email**: set `SMTP_*` and `MAIL_FROM`. Until then, emails are written to `./outbox/`.
- **HubSpot**: set `HUBSPOT_TOKEN` (private-app). Configure which object/property holds
  the payment status via `HUBSPOT_PAYMENT_STATUS_OBJECT` (`deal`|`contact`) and
  `HUBSPOT_PAYMENT_STATUS_PROPERTY` (default `event_payment_status`). Create the custom
  deal properties (`event_name`, `soa_invoice_number`, `soa_tracking_number`) or they're
  skipped gracefully.
- **Shopify**: the store domain and links are in `config/event.js`. Point a
  **"Order payment"** webhook at `POST /webhooks/shopify/order-paid` and set
  `SHOPIFY_WEBHOOK_SECRET` to verify the HMAC. Orders are matched to an SOA by invoice
  number in the order note, else by requestor/registrant email.
- **Sales invoice request** (`INVOICE_REQUEST_MODE`): `email` (to `INVOICE_REQUEST_EMAIL`),
  `webhook` (POST JSON to `INVOICE_REQUEST_WEBHOOK_URL` — e.g. your accounting system,
  Zapier/Make), or `none`.

## Project structure

```
config/            event, pricing, and env loader (safe to commit)
src/
  server.js        Express app + routing / raw-body for webhooks
  routes/          registration, soa, webhooks
  services/        pricing, soaGenerator, pdf, email, hubspot, shopify, invoice
  templates/       soaEmail (HTML + text)
  lib/             json store, validation
public/index.html  registration / SOA-request form with live preview
test/              node:test suites (pricing + SOA/PDF/checkout)
```

## Notes & next steps

- Persistence is a dependency-free JSON store under `./data` (fine for event volume).
  Swap `src/lib/store.js` for Postgres/Airtable behind the same interface when needed.
- Webhook processing is idempotent (Shopify may deliver duplicates).
- Replace the placeholder rates and confirm the VAT-exempt treatment with finance
  before issuing real SOAs.
