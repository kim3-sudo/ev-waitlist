// A minimal OCPP1.6J charge point, for exercising the central system without
// real hardware.
//
// Usage:
//   node src/simulator/chargePoint.js <identity> [connectorCount]
//
// Then, at the prompt, report any OCPP 1.6 connector status:
//   available <connectorId>      - free and ready
//   preparing <connectorId>      - cable connected, not yet authorized
//   charging <connectorId>       - actively charging
//   suspendedev <connectorId>    - plugged in, not charging (e.g. battery full) -- transaction still open
//   suspendedevse <connectorId>  - plugged in, not charging -- station-side suspension
//   finishing <connectorId>      - transaction stopped, cable not yet removed
//   reserved <connectorId>       - held for a reservation
//   unavailable <connectorId>    - taken out of service
//   faulted <connectorId>        - error condition
//   start <connectorId> <idTag>  - send StartTransaction
//   stop <transactionId>         - send StopTransaction
//   quit
import readline from 'node:readline';
import { RPCClient } from 'ocpp-rpc';

// OCPP 1.6 ChargePointStatus values, keyed by the lowercase command word.
const STATUS_ALIASES = {
  available: 'Available',
  preparing: 'Preparing',
  charging: 'Charging',
  suspendedev: 'SuspendedEV',
  suspendedevse: 'SuspendedEVSE',
  finishing: 'Finishing',
  reserved: 'Reserved',
  unavailable: 'Unavailable',
  faulted: 'Faulted',
};

const identity = process.argv[2];
const connectorCount = Number(process.argv[3] ?? 1);
const endpoint = process.env.CS_ENDPOINT ?? 'ws://localhost:4000/ocpp';

if (!identity) {
  console.error('Usage: node src/simulator/chargePoint.js <identity> [connectorCount]');
  process.exit(1);
}

const cli = new RPCClient({
  endpoint,
  identity,
  protocols: ['ocpp1.6'],
  strictMode: true,
});

cli.handle('ReserveNow', ({ params }) => {
  console.log(`\n[cp] ReserveNow received:`, params);
  return { status: 'Accepted' };
});

cli.handle('CancelReservation', ({ params }) => {
  console.log(`\n[cp] CancelReservation received:`, params);
  return { status: 'Accepted' };
});

cli.handle('RemoteStartTransaction', ({ params }) => {
  console.log(`\n[cp] RemoteStartTransaction received:`, params);
  return { status: 'Accepted' };
});

cli.handle(({ method, params }) => {
  console.log(`\n[cp] Unhandled ${method}:`, params);
  return {};
});

try {
  await cli.connect();
} catch (err) {
  if (err.code === 404) {
    console.error(
      `[cp] Connection rejected (404): no station with identity "${identity}" is registered.\n` +
        `     Create it first in the admin UI (or via POST /api/admin/stations) with this exact identity.`,
    );
  } else {
    console.error(`[cp] Failed to connect to ${endpoint}:`, err.message);
  }
  process.exit(1);
}
console.log(`[cp] ${identity} connected to ${endpoint}`);

await cli.call('BootNotification', {
  chargePointVendor: 'simulator',
  chargePointModel: 'simulator',
});

await cli.call('StatusNotification', { connectorId: 0, errorCode: 'NoError', status: 'Available' });
for (let i = 1; i <= connectorCount; i += 1) {
  await cli.call('StatusNotification', { connectorId: i, errorCode: 'NoError', status: 'Available' });
}
console.log(`[cp] Reported ${connectorCount} connector(s) as Available`);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' });
rl.prompt();

// readline emits 'line' for every buffered line without waiting for an
// async handler to finish, so fast/piped input can race commands against
// each other (e.g. `quit` closing the socket while a prior call is still
// in flight). Chain handling through a promise queue to serialize it.
let queue = Promise.resolve();
rl.on('line', (line) => {
  queue = queue.then(() => handleLine(line));
});

async function handleLine(line) {
  const [cmd, a, b] = line.trim().split(/\s+/);
  try {
    if (STATUS_ALIASES[cmd]) {
      const status = STATUS_ALIASES[cmd];
      await cli.call('StatusNotification', { connectorId: Number(a), errorCode: 'NoError', status });
      console.log(`[cp] connector ${a} -> ${status}`);
    } else if (cmd === 'start') {
      const res = await cli.call('StartTransaction', {
        connectorId: Number(a),
        idTag: b,
        meterStart: 0,
        timestamp: new Date().toISOString(),
      });
      console.log('[cp] StartTransaction ->', res);
    } else if (cmd === 'stop') {
      const res = await cli.call('StopTransaction', {
        transactionId: Number(a),
        meterStop: 1000,
        timestamp: new Date().toISOString(),
      });
      console.log('[cp] StopTransaction ->', res);
    } else if (cmd === 'quit') {
      await cli.close();
      process.exit(0);
    } else {
      console.log(
        `Commands: ${Object.keys(STATUS_ALIASES).join(' | ')} <connectorId> | start <id> <idTag> | stop <txId> | quit`,
      );
    }
  } catch (err) {
    console.error('[cp] Error:', err.message);
  }
  if (!rl.closed) rl.prompt();
}

rl.on('close', async () => {
  // On piped input, 'close' fires right after all 'line' events are
  // dispatched -- before their queued async handlers have actually run.
  // Let the queue drain first so buffered commands aren't dropped.
  await queue;
  process.exit(0);
});
