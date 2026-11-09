# Install

New install only. To move an existing one, read [Upgrading](upgrading.md) first.

## Before you start

- Install Node.js (current LTS) and npm.
- Get a public HTTPS address if drivers pay by card or charge points connect to you.

## Quick start (SQLite)

```bash
npm install
npm start
```

On the first run, the server prints a first administrator's email and passphrase. Save them.

1. Sign in with the printed details and set a new passphrase.
2. Follow the setup wizard: enter your operator name, your first charge point, and your branding.

To try a simulated charge point (`SIM-001`, two connectors), run `npm start -- --simulator`.

## Choose a database

Set the database in the root `.env` file.

| Database | Use for | `.env` settings |
| --- | --- | --- |
| SQLite (default) | One site, evaluation | `DATABASE_URL="file:../../data/dev.db"` |
| PostgreSQL | Multiple sites, OCPI, busy installs | `DATABASE_PROVIDER=postgresql` and `DATABASE_URL="postgresql://user:password@host:5432/database"` |
| MariaDB | Same as PostgreSQL | `DATABASE_PROVIDER=mysql` and `DATABASE_URL="mysql://user:password@host:3306/database"` |

- Create an empty database first. The server creates the tables.
- After you change `DATABASE_PROVIDER`, run `npm start` again to regenerate the Prisma client.
- Use PostgreSQL or MariaDB for multiple sites or OCPI. The tests run on SQLite, PostgreSQL 16, and MariaDB 13.

## Secrets

The server needs two secrets:

- `JWT_SECRET` signs administrator sessions.
- `CONFIG_ENCRYPTION_KEY` encrypts payment provider keys.

You can skip this step. On first start, the server generates both and saves them to `data/secrets.json`. To set your own, add them to `.env` using `openssl rand -base64 32`.

- Back up `data/secrets.json` or your own values. Without the encryption key, you must re-enter saved payment keys.
- Keep the secrets out of version control.
- Replace the placeholder values `dev-secret-change-me` and `change-me-to-a-long-random-string`. The server refuses to start with them.

## Set the public address

In **Admin > System**, enter your public address, such as `https://ev.example.com`. The server uses it for payment links, payment and single sign-on callbacks, and the Square webhook.

Put the server behind a reverse proxy that terminates TLS, and configure the proxy as follows:

- Forward WebSocket upgrades on `/ocpp/`.
- Turn off buffering for paths ending in `/live`. In nginx, set `proxy_buffering off;`.

## Settings in `.env`

| Variable | Purpose |
| --- | --- |
| `DATABASE_PROVIDER` | `sqlite` (default), `postgresql`, or `mysql` |
| `DATABASE_URL` | Connection string for your database |
| `PORT` | API port (default `4000`) |
| `JWT_SECRET` | Optional. See [Secrets](#secrets) |
| `CONFIG_ENCRYPTION_KEY` | Optional. See [Secrets](#secrets) |
| `DATA_DIR` | Optional. Where `secrets.json` lives (default `data`) |

Set everything else in the admin pages. `.env.example` lists optional first-run seeds, such as `PUBLIC_URL` and `CORS_ORIGIN`. The server copies them into the database once.

## Run in production

- Run `npm start` under a process manager that restarts it on failure.
- Back up the database and `data/secrets.json` together, on a schedule.
- Keep `.env` out of version control.
