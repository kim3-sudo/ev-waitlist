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

The simulator also has a control page at http://127.0.0.1:4100 (set `SIM_UI_PORT` to change the port, or `0` to turn it off). From there you can set each connector's status, start and stop sessions, and see every message exchanged with the central system.

The simulator acts as one of two EVSEs, chosen on the control page (or with `SIM_EVSE_PROFILE=basic` or `full` before starting):

- **Basic EVSE** answers the OCPP 1.6J Core profile, the minimum every charge point supports. Status changes are made by hand, and no meter values are sent.
- **Full-featured EVSE** also answers the Reservation, Smart Charging, Local Auth List, Firmware Management and Remote Trigger profiles. It sends meter values while charging, moves connectors through Charging and Finishing on its own, and reports faults with error codes.

Messages outside the chosen profile get a NotSupported reply. The OCPP 1.6J reference is at https://ocpp.md/ocpp-1.6j/.

Or run the servers in separate terminals with `npm run dev:server` and `npm run dev:web`.

## To Start Test EVSE

```bash
npm run simulate --workspace server -- CP001
```

Or let `npm start -- --simulator` do it for you (see above).