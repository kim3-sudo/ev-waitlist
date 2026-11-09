# Upgrade an existing installation

This version adds sites, an operator, retention settings, a roaming switch, and per-site settings. Your single site moves into a site named `default`, and it keeps working.

## Back up first

1. **Back up the database.**
   - SQLite: stop the server and copy the file. Older installs use `server/prisma/dev.db`. Newer installs use `data/dev.db`.
   - PostgreSQL or MariaDB: take a dump with your usual tool.
2. **Back up secrets.** Copy `server/data/secrets.json` (if it exists) and your `.env`.
3. **Check `JWT_SECRET`.** Remove it from `.env` if it's `dev-secret-change-me` or `change-me-to-a-long-random-string`. The server refuses to start with those values. It generates a new secret instead.

## Move local data (optional)

Databases and secrets now live in `data/`. An older install that uses `server/data/secrets.json` keeps working, and the server logs a notice. To finish the move, stop the server, then:

- Move `server/data/secrets.json` to `data/secrets.json`. Keep permissions at 0600.
- Either move your SQLite file to `data/dev.db` and set `DATABASE_URL="file:../../data/dev.db"` in `.env`, or leave `DATABASE_URL` unchanged.

Don't generate new secrets during the move. A new encryption key makes saved payment keys unreadable.

## Upgrade

```bash
git pull          # or however you get the new version
npm install
npm start
```

The server applies migrations on start. It creates the operator and the `default` site, moves your existing data into that site, and makes the earliest administrator the installation administrator. Closed queue entries get their closing time set to their creation time, so their personal data is removed sooner, not later.

Upgrades move forward only. To roll back, restore your backup.

## Expect these changes

- Administrators sign in again if you used the built-in default JWT secret.
- Existing addresses keep working for the default site, including payment and single sign-on callbacks.
- Roaming is off, and retention is 30 days for queue data and payer details.

## After you upgrade

1. Sign in as the installation administrator.
2. Open **Sites**, and set the operator name. Add a country code and party ID only if you roam.
3. Open **Privacy**, and confirm the retention periods.
4. Open **Integrations**, and confirm your payment providers still show as configured. If a key is unreadable, re-enter it. This happens when `CONFIG_ENCRYPTION_KEY` has changed.
5. To add sites, follow [More than one site](operator-checklist.md#more-than-one-site).
