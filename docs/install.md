# Install

This guide covers a new installation. To move an existing one, read [Upgrading](upgrading.md) first.

## Requirements

- Node.js (a current LTS release) and npm.
- One of the databases below. SQLite needs nothing else.
- For drivers to pay by card, or for charge points and payment providers to reach you, a public HTTPS address (see [Public address](#public-address)).

## Quick start (one site, SQLite)

```bash
npm install
npm start
```

On the first run the server:

1. creates the database and a first administrator with a random email and passphrase, and prints them once;
2. generates the two installation secrets (see [Secrets](#secrets)) if you have not set them;
3. starts the web app and the API.

Sign in with the printed details, choose a new passphrase, and follow the setup wizard. The wizard asks for the operator name (the company that runs the installation), your first charge point, and branding.

To try it with a simulated charge point (station `SIM-001`, two connectors):

```bash
npm start -- --simulator
```

## Choosing a database

The database is set in the root `.env` file.

| Option | Use it for | Set in `.env` |
| --- | --- | --- |
| SQLite (default) | One site, evaluation, small installs | `DATABASE_URL="file:../../data/dev.db"` (the file is kept in `data/` in the project root) |
| PostgreSQL | More than one site, OCPI, busier installs | `DATABASE_PROVIDER=postgresql` and `DATABASE_URL="postgresql://user:password@host:5432/database"` |
| MariaDB | Same as PostgreSQL | `DATABASE_PROVIDER=mysql` and `DATABASE_URL="mysql://user:password@host:3306/database"` |

The test suite runs against SQLite, PostgreSQL 16 and MariaDB 13.

Notes:

- Create an empty database first. The server creates the tables.
- The Prisma client is generated for one database type. If you change `DATABASE_PROVIDER`, run `npm start` again so the client is regenerated.
- Multi-site installations and OCPI should use PostgreSQL or MariaDB. The server does not stop you from using SQLite for them, but SQLite is not tested under concurrent multi-site load.

## Secrets

Two secrets protect the installation:

- `JWT_SECRET` signs administrator sessions.
- `CONFIG_ENCRYPTION_KEY` encrypts payment provider keys stored in the database.

You do not need to set either one. If they are unset, the server generates both on first start and keeps them in `data/secrets.json` (in the project root) (permissions 0600, git-ignored). You can also set your own in `.env`, using a long random value (`openssl rand -base64 32`).

- **Back up `data/secrets.json`** (or your own values). If the encryption key is lost, saved payment keys can no longer be read and must be entered again.
- The server refuses to start if either secret is set to a placeholder copied from the examples (`dev-secret-change-me` or `change-me-to-a-long-random-string`).
- Do not copy `data/secrets.json` into version control or share it.

## Public address

Set the public address in **Admin > System** (for example `https://ev.example.com`). It is used in:

- links sent to drivers (payment links);
- the callback addresses that payment providers and single sign-on use;
- the Square webhook address.

Put the server behind a reverse proxy that terminates TLS. Make sure the proxy forwards WebSocket upgrades on `/ocpp/` for charge points.

## Settings in `.env`

Only what the server needs before it can reach the database is in `.env`. Everything else is set in the admin pages.

| Variable | Purpose |
| --- | --- |
| `DATABASE_PROVIDER` | `sqlite` (default), `postgresql` or `mysql` |
| `DATABASE_URL` | Connection string for the chosen database |
| `PORT` | API port (default 4000) |
| `JWT_SECRET` | Optional; see [Secrets](#secrets) |
| `CONFIG_ENCRYPTION_KEY` | Optional; see [Secrets](#secrets) |
| `DATA_DIR` | Optional; where `secrets.json` is kept (default `data` in the project root) |

The `.env.example` file lists the optional first-run seeds (`PUBLIC_URL`, `CORS_ORIGIN`, payment keys and so on). They are copied into the database once, the first time, and the admin pages take over after that.

## Running in production

- Use a process manager to keep `npm start` running, and restart it on failure.
- Back up the database and `data/secrets.json` together, on a schedule.
- Keep `.env` out of version control.
