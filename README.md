# Plugyard

> **Legal notice.** Plugyard is open-source software provided as is. It does not provide legal advice. If you run charging sites, the features that touch the law are yours to review with your own counsel before you use them: roaming (OCPI) terms and the warning drivers see, payments, retention of drivers' personal data, and payer records. The defaults are starting points, not legal advice.

## Documentation

- [Install](docs/install.md): requirements, the three database options, and first run.
- [Upgrading](docs/upgrading.md): moving an existing single-site install to this version.
- [Operator checklist](docs/operator-checklist.md): what to set up and review before drivers use the site.
- [Roaming (OCPI)](docs/ocpi.md): what roaming needs, and what is not built yet.
- [Security](SECURITY.md): how to report a vulnerability.

## To Run

```bash
npm start        # starts the server and web UI together
```

`npm start` prepares the database on every run. On the very first run it creates an admin account with a random email and passphrase and prints them in the console. Sign in with those, choose a new passphrase when prompted, and the setup wizard walks you through adding your first charge point and branding.

To also run a charge point simulator (station `SIM-001`, 2 connectors) alongside everything else:

```bash
npm start -- --simulator
```

Or run the servers in separate terminals with `npm run dev:server` and `npm run dev:web`.

## To Start Test EVSE

```bash
npm run simulate --workspace server -- CP001
```

Or let `npm start -- --simulator` do it for you (see above).