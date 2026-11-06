# Operator checklist

Work through this before drivers use the site. Items marked **legal** need your own counsel. EV Waitlist does not provide legal advice.

## 1. Legal review (legal)

- [ ] **Roaming terms and warning** (only if you will allow roaming drivers). Have counsel review the terms and the warning text. The required text is a draft. Turn roaming on only after the review, under **Roaming**, and tick the acknowledgement.
- [ ] **Retention periods** (**Privacy**). Confirm the queue and payer-record periods match your data-protection and accounting obligations. The defaults are 30 days.
- [ ] **Payer records.** Decide whether payer details on charges are kept after the financial period, or set "keep indefinitely" only if your own duties require it.
- [ ] **Payment terms.** Confirm the terms of your payment providers with your own advisers.
- [ ] **Privacy notice.** Tell drivers what you collect (name, contact, plate or permit number), why, and how long you keep it.

## 2. Operator and identity

- [ ] **Operator name** (**Sites > Operator**): the company that runs the installation.
- [ ] **Country code and party ID**: only if you roam. Your roaming scheme or partners assign the party ID. Do not invent one.

## 3. Payments

- [ ] Enter each site's own provider keys under **Integrations**. Keys are encrypted with `CONFIG_ENCRYPTION_KEY`.
- [ ] Set the provider's webhook address (see [Webhook addresses](#webhook-addresses)) and paste its signing secret into the matching field.
- [ ] Choose the active provider under **Payments**, and test a small charge.
- [ ] **Legal review of pricing.** Time-based billing, time windows, and free charging each have their own rules in some places. Power-based billing may need a license. Check each with your own advisers before you use it.
- [ ] **Card holds, if you use them.** Test a hold with a small amount, and confirm the hold is released when a session costs less or never starts. Tell drivers they must place the hold when they are called. Stripe and Braintree each release a hold that is not captured in time, so check the periods in their terms.
- [ ] **Price check.** Use the rate calculator with your real bills, and check the price check's warning before you confirm a high rate.

### Webhook addresses

| Site | Stripe | Square |
| --- | --- | --- |
| Default (first) site | `https://YOUR-PUBLIC-ADDRESS/api/payments/stripe/webhook` | `https://YOUR-PUBLIC-ADDRESS/api/payments/square/webhook` |
| A named site (slug `garage`) | `https://YOUR-PUBLIC-ADDRESS/api/t/garage/payments/stripe/webhook` | `https://YOUR-PUBLIC-ADDRESS/api/t/garage/payments/square/webhook` |

Each site's events are checked with that site's own secret, and a payment is only recorded for a charge in that site.

## 4. Security

- [ ] **Public address** set under **System**, served over HTTPS.
- [ ] **Secrets backed up**: `data/secrets.json` (or your own values in `.env`).
- [ ] **Database backed up** on a schedule, together with the secrets.
- [ ] **Multi-factor sign-in** turned on for administrators (**Users**, or the site-wide policy under **Branding**).
- [ ] Each person has their own account. Give the least permission that does the job, using custom roles.
- [ ] Single sign-on, if used, configured per site under **Single sign-on**.

## 5. Stations and operations

- [ ] Add charge points under **Charge points**, with the identity your charge points use in their address.
- [ ] Group chargers that share a queue into a **Zone**.
- [ ] Check the reservation window under **System**.
- [ ] Use **Complaints** to review line-cutting reports, and resolve them.

## More than one site

- One installation serves one operator. Sites under it share the operator record.
- Only the installation administrator (the first administrator) creates sites, adds administrators to them, and deletes them. A site can be deleted only once it has no charge points, administrators or history.
- Use **Sites** to add a site, then add its administrator. The administrator signs in as usual; the site is their home.
- The installation administrator can work in another site by choosing it in the site selector at the top of the admin pages.
- Each site has its own branding, payment keys, roaming switch, retention periods and single sign-on settings.
- Drivers reach a site's waitlist at `/t/<site address>` on your public address.
