# Operator checklist

Complete these steps before drivers use the site. Items marked **legal** need review by your own counsel. Plugyard does not give legal advice.

## 1. Legal (legal)

- [ ] **Roaming terms and warning.** Have counsel review them. Turn roaming on under **Roaming** only after review, and tick the acknowledgement.
- [ ] **Retention periods** under **Privacy**. The defaults are 30 days. Match them to your obligations.
- [ ] **Payer records.** Decide how long to keep payer details on charges. Choose "keep indefinitely" only if the law requires it.
- [ ] **Payment terms.** Confirm your payment providers' terms.
- [ ] **Privacy notice.** Tell drivers what you collect (name, contact, plate or permit number), why, and for how long.

## 2. Operator

- [ ] Enter your company name under **Sites > Operator**.
- [ ] Enter a country code and party ID only if you roam. Get the party ID from your roaming scheme. Don't invent one.

## 3. Payments

- [ ] Enter each site's provider keys under **Integrations**. The server encrypts them with `CONFIG_ENCRYPTION_KEY`.
- [ ] Paste the webhook signing secret into the matching field, using the address in the table below.
- [ ] Choose the active provider under **Payments**, and run a small test charge.
- [ ] Have your advisers review pricing rules: time-based billing, time windows, free charging, and power-based billing (which may need a license).
- [ ] If you take card holds, test a small hold. Confirm the hold releases when a session costs less or never starts. Tell drivers to place the hold when called. Check how long Stripe and Braintree keep uncaptured holds.
- [ ] Test your prices with the rate calculator on real bills. Read the price check's warning before you confirm a high rate.

### Webhook addresses

Replace `YOUR-PUBLIC-ADDRESS` with your public address.

| Site | Stripe | Square |
| --- | --- | --- |
| Default (first) site | `https://YOUR-PUBLIC-ADDRESS/api/payments/stripe/webhook` | `https://YOUR-PUBLIC-ADDRESS/api/payments/square/webhook` |
| Named site (for example `garage`) | `https://YOUR-PUBLIC-ADDRESS/api/t/garage/payments/stripe/webhook` | `https://YOUR-PUBLIC-ADDRESS/api/t/garage/payments/square/webhook` |

Each site checks events with its own secret.

## 4. Security

- [ ] Set the public address under **System**, served over HTTPS.
- [ ] Back up `data/secrets.json` (or your own values in `.env`).
- [ ] Back up the database on a schedule, together with the secrets.
- [ ] Turn on multi-factor sign-in for administrators under **Users** or **Branding**.
- [ ] Give each person their own account. Use custom roles to grant the least permission they need.
- [ ] Configure single sign-on per site under **Single sign-on**, if you use it.

## 5. Stations

- [ ] Add charge points under **Charge points**. Use the identity your charge points use in their address.
- [ ] Group chargers that share a queue into a **Zone**.
- [ ] Check the reservation window under **System**.
- [ ] Review line-cutting reports under **Complaints**, and resolve them.

## More than one site

- Create sites under **Sites**. Only the installation administrator (the first administrator) can create, delete, or assign administrators to sites.
- Delete a site only after you remove its charge points, administrators, and history.
- Switch sites with the selector at the top of the admin pages.
- Set branding, payment keys, roaming, retention, and single sign-on separately for each site.
- Point drivers to `/t/<site address>` on your public address.
