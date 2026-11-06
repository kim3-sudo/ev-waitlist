# Upgrading an existing installation

This version adds sites, an operator, retention settings, a roaming switch and per-site settings. An existing single-site installation keeps working, and its data moves into one site called `default`.

## Before you start

1. **Back up the database.**
   - SQLite: stop the server and copy the database file. An older install keeps it at `server/prisma/dev.db`; newer installs use `data/dev.db` in the project root.
   - PostgreSQL or MariaDB: take a dump with your usual tool.
2. **Back up your secrets.** Copy `server/data/secrets.json` if it exists, and your `.env`.

**Moving local data.** Databases and generated secrets now live in `data/` in the project root, which is not committed. An older install that still has `server/data/secrets.json` keeps using that file, and the server logs a notice until you move it. To finish the move, stop the server and:

- move `server/data/secrets.json` to `data/secrets.json`, keeping its permissions at 0600;
- either move your SQLite database to `data/dev.db` and set `DATABASE_URL="file:../../data/dev.db"` in `.env`, or leave `DATABASE_URL` as it is.

Do not generate new secrets during the move. A new encryption key makes saved payment keys unreadable.
3. **Check `JWT_SECRET` in `.env`.** If it is set to `dev-secret-change-me` or `change-me-to-a-long-random-string`, the server now refuses to start. Remove the line (a new secret is generated) or set a real value.

## Upgrade

```bash
git pull          # or however you get the new version
npm install
npm start
```

The server applies the new database migrations on start. They:

- create the operator record and the first site (`default`), named after your current branding name;
- move all existing rows (stations, zones, queue, charges, administrators, settings) into that site;
- make the earliest administrator the **installation administrator** (the one who can manage sites and the operator);
- set the time each already-closed queue entry was closed to the time it was created. The real closing time was not recorded before, so the retention clock for those entries starts from creation. That makes their personal details clear sooner, not later.

Upgrades only move forward. To go back, restore the backup you took.

## What changes for people using the site

- **Administrators are signed out once** if the installation previously used the built-in default JWT secret, because a new secret is generated. They sign in again.
- **Existing public and admin addresses keep working.** The default site uses the same web and API addresses as before.
- **Payment and single sign-on addresses do not change** for the default site. The Stripe, Square and single sign-on callbacks you already configured still apply.
- **Roaming is off**, and **retention is set to 30 days** for both queue data and payer details. Check both (see [Operator checklist](operator-checklist.md)).

## After upgrading

1. Sign in as the installation administrator.
2. Open **Sites** and set the operator name. Add the country code and party ID only if you will roam.
3. Open **Privacy** and confirm the retention periods match your obligations.
4. Check **Integrations** still shows your payment providers as configured. If a key shows as unreadable, re-enter it (this happens when `CONFIG_ENCRYPTION_KEY` has changed).
5. If you will add more sites, read [Operator checklist](operator-checklist.md#more-than-one-site).
