# EV Waitlist

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