// A simulated OCPP 1.6J charge point, for exercising the central system without
// real hardware. It acts as one of two EVSE profiles (see ./profiles.js):
//
//   basic  - Core profile only: status, sessions, remote start and stop, reset,
//            availability and configuration. Status changes are made by hand.
//   full   - also the Reservation, SmartCharging, LocalAuthListManagement,
//            FirmwareManagement and RemoteTrigger profiles, meter values while
//            charging, and automatic status changes during a session.
//
// Usage:
//   node src/simulator/chargePoint.js <identity> [connectorCount]
//
// Environment:
//   CS_ENDPOINT        central system URL (default ws://localhost:4000/ocpp)
//   SIM_EVSE_PROFILE   basic or full (default basic); can also be changed on the control page
//   SIM_UI_PORT        control page port on 127.0.0.1 (default 4100; 0 turns it off)
//
// The control page at http://127.0.0.1:<SIM_UI_PORT> does everything the prompt does,
// plus the full-featured controls and a log of each message exchanged.
//
// At the prompt:
//   available|preparing|charging|suspendedev|suspendedevse|finishing|reserved|
//   unavailable|faulted <connectorId>   - report a connector status
//   start <connectorId> <idTag>         - send StartTransaction
//   stop <transactionId>                - send StopTransaction
//   profile basic|full                  - switch the EVSE profile
//   quit
import readline from 'node:readline';
import ocpp from 'ocpp-rpc';

// ocpp-rpc is CommonJS, so its named exports come from the default export.
const { RPCClient, RPCNotImplementedError, RPCNotSupportedError } = ocpp;
import { CommandError, createControlApp } from './controlPage.js';
import { DEFAULT_PROFILE, PROFILE_MESSAGES, PROFILES, isProfile } from './profiles.js';

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
const STATUSES = Object.values(STATUS_ALIASES);

// OCPP 1.6 ChargePointErrorCode values.
const ERROR_CODES = [
  'ConnectorLockFailure',
  'EVCommunicationError',
  'GroundFailure',
  'HighTemperature',
  'InternalError',
  'LocalListConflict',
  'NoError',
  'OtherError',
  'OverCurrentFailure',
  'OverVoltage',
  'PowerMeterFailure',
  'PowerSwitchFailure',
  'ReaderFailure',
  'ResetFailure',
  'UnderVoltage',
  'WeakSignal',
];

// Standard OCPP 1.6 Core configuration keys. `readonly` keys can't be changed by ChangeConfiguration.
const CONFIG_DEFS = [
  { key: 'AllowOfflineTxForUnknownId', type: 'boolean', readonly: false, value: 'false' },
  { key: 'AuthorizationCacheEnabled', type: 'boolean', readonly: false, value: 'true' },
  { key: 'AuthorizeRemoteTxRequests', type: 'boolean', readonly: false, value: 'false' },
  { key: 'ClockAlignedDataInterval', type: 'integer', readonly: false, value: '0' },
  { key: 'ConnectionTimeOut', type: 'integer', readonly: false, value: '60' },
  { key: 'GetConfigurationMaxKeys', type: 'integer', readonly: true, value: '50' },
  { key: 'HeartbeatInterval', type: 'integer', readonly: false, value: '300' },
  { key: 'LocalAuthorizeOffline', type: 'boolean', readonly: false, value: 'true' },
  { key: 'LocalPreAuthorize', type: 'boolean', readonly: false, value: 'false' },
  { key: 'MeterValueSampleInterval', type: 'integer', readonly: false, value: '10' },
  {
    key: 'MeterValuesSampledData',
    type: 'csl',
    readonly: false,
    value: 'Energy.Active.Import.Register,Power.Active.Import,Current.Import,Voltage,SoC,Temperature',
  },
  { key: 'NumberOfConnectors', type: 'integer', readonly: true, value: '' }, // set at startup
  { key: 'ResetRetries', type: 'integer', readonly: false, value: '1' },
  { key: 'StopTransactionOnEVSideDisconnect', type: 'boolean', readonly: false, value: 'true' },
  { key: 'StopTransactionOnInvalidId', type: 'boolean', readonly: false, value: 'true' },
  { key: 'SupportedFeatureProfiles', type: 'csl', readonly: true, value: '' }, // follows the profile
  { key: 'TransactionMessageAttempts', type: 'integer', readonly: false, value: '3' },
  { key: 'TransactionMessageRetryInterval', type: 'integer', readonly: false, value: '30' },
  { key: 'UnlockConnectorOnEVSideDisconnect', type: 'boolean', readonly: false, value: 'true' },
  { key: 'WebSocketPingInterval', type: 'integer', readonly: false, value: '0' },
];

const MAX_EVENTS = 200;
const SUPPLY_VOLTS = 230;
const PHASES = 3; // used to turn amps into watts in charging profiles
const AMBIENT_C = 25;
const BATTERY_WH = 60000; // the simulated car's battery, for the state of charge
const DEFAULT_POWER_KW = 7.4;
const DEFAULT_START_SOC = 20;
const METER_TICK_MS = 1000;
const MAX_TIMER_MS = 2 ** 31 - 1;

const identity = process.argv[2];
const connectorCount = Number(process.argv[3] ?? 1);
const endpoint = process.env.CS_ENDPOINT ?? 'ws://localhost:4000/ocpp';
const controlPort = Number(process.env.SIM_UI_PORT ?? 4100);

if (!identity) {
  console.error('Usage: node src/simulator/chargePoint.js <identity> [connectorCount]');
  process.exit(1);
}

const pinnedProfile = process.env.SIM_EVSE_PROFILE;
if (pinnedProfile && !isProfile(pinnedProfile)) {
  console.error(`[cp] Unknown SIM_EVSE_PROFILE "${pinnedProfile}"; using ${DEFAULT_PROFILE}.`);
}

// ---- state -----------------------------------------------------------------

function newConnector(id) {
  return {
    id,
    status: null, // last status sent
    errorCode: 'NoError',
    availability: 'Operative', // or Inoperative, from ChangeAvailability
    pendingAvailability: null, // applied when the current session ends
    powerKw: DEFAULT_POWER_KW, // what the car draws at most
    meterWh: 0, // energy register; never resets
    powerW: 0,
    currentA: 0,
    temperatureC: AMBIENT_C,
    socPct: null, // state of charge, full profile only
    transactionId: null,
    reservation: null, // { reservationId, idTag, expiryDate, timer }
    lastSample: 0,
  };
}

const state = {
  profile: isProfile(pinnedProfile) ? pinnedProfile : DEFAULT_PROFILE,
  connected: false,
  connectors: new Map(), // connectorId -> connector
  transactions: new Map(), // transactionId -> { connectorId, idTag, idTagStatus, startedAt, meterStartWh, startSoc }
  config: new Map(CONFIG_DEFS.map((d) => [d.key, d.value])),
  localList: { version: 0, entries: new Map() },
  authCache: new Set(),
  chargingProfiles: [], // { connectorId, chargingProfileId, purpose, stackLevel, unit, limit, watts }
  firmwareStatus: 'Idle',
  diagnosticsStatus: 'Idle',
  events: [], // { at, direction: 'sent' | 'received' | 'error' | 'info', text }
};
for (let id = 1; id <= connectorCount; id += 1) state.connectors.set(id, newConnector(id));
state.config.set('NumberOfConnectors', String(connectorCount));

function record(direction, text) {
  state.events.push({ at: new Date().toISOString(), direction, text });
  if (state.events.length > MAX_EVENTS) state.events.splice(0, state.events.length - MAX_EVENTS);
}

function received(method, params, note) {
  record('received', `${method} ${JSON.stringify(params ?? {})}${note ? ` (${note})` : ''}`);
  console.log(`\n[cp] ${method} received:`, params);
}

const isFull = () => state.profile === 'full';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const round1 = (n) => Math.round(n * 10) / 10;
const clampPct = (n) => {
  const value = Number(n);
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : DEFAULT_START_SOC;
};

// Runs work that can fail without a caller to report to. Errors go to the log.
function background(label, promise) {
  Promise.resolve(promise).catch((err) => {
    console.error(`[cp] ${label} failed: ${err.message}`);
    record('error', `${label} failed: ${err.message}`);
  });
}

// Sends work after the reply to the current request has gone out.
function afterReply(label, fn) {
  background(label, delay(200).then(fn));
}

function requireConnector(connectorId) {
  const c = state.connectors.get(connectorId);
  if (!c) throw new CommandError(400, `Connector must be between 1 and ${connectorCount}.`);
  return c;
}

function limitW(connectorId) {
  if (!isFull()) return Infinity;
  const limits = state.chargingProfiles
    .filter((p) => p.connectorId === 0 || p.connectorId === connectorId)
    .map((p) => p.watts);
  // Simplification: the lowest limit applies, whatever the profile's purpose or stack level.
  return limits.length ? Math.min(...limits) : Infinity;
}

// ---- configuration ---------------------------------------------------------

function configValue(key) {
  if (key === 'SupportedFeatureProfiles') return PROFILES[state.profile].featureProfiles;
  return state.config.get(key);
}

function configEntries() {
  return CONFIG_DEFS.map((d) => ({ key: d.key, value: configValue(d.key), readonly: d.readonly, type: d.type }));
}

// Measurands the simulator can report in MeterValues.
const MEASURANDS = {
  'Energy.Active.Import.Register': { unit: 'Wh', value: (c) => Math.round(c.meterWh) },
  'Power.Active.Import': { unit: 'W', value: (c) => Math.round(c.powerW) },
  'Current.Import': { unit: 'A', value: (c) => round1(c.currentA) },
  Voltage: { unit: 'V', value: () => SUPPLY_VOLTS },
  SoC: { unit: 'Percent', value: (c) => (c.socPct === null ? null : Math.round(c.socPct)) },
  Temperature: { unit: 'Celsius', value: (c) => round1(c.temperatureC) },
};

function sampledMeasurands(value) {
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function validConfigValue(def, value) {
  if (typeof value !== 'string' || value.length > 500) return false;
  if (def.type === 'boolean') return value === 'true' || value === 'false';
  if (def.type === 'integer') return /^\d+$/.test(value);
  if (def.key === 'MeterValuesSampledData') {
    const names = sampledMeasurands(value);
    return names.length > 0 && names.every((n) => Object.hasOwn(MEASURANDS, n));
  }
  return true;
}

// Returns the OCPP ConfigurationStatus for the change.
function applyConfiguration(key, value) {
  const def = CONFIG_DEFS.find((d) => d.key === key);
  if (!def) return 'NotSupported';
  if (def.readonly || !validConfigValue(def, value)) return 'Rejected';
  state.config.set(key, value);
  if (key === 'HeartbeatInterval') restartHeartbeat();
  record('info', `Configuration ${key} = ${value}`);
  return 'Accepted';
}

// ---- charge point -> central system ----------------------------------------

const cli = new RPCClient({
  endpoint,
  identity,
  protocols: ['ocpp1.6'],
  strictMode: true,
});

cli.on('open', () => {
  state.connected = true;
  record('info', `Connected to ${endpoint}`);
});
cli.on('disconnect', () => {
  state.connected = false;
  record('error', 'Disconnected from the central system. Reconnecting...');
});

async function bootNotification() {
  await cli.call('BootNotification', { chargePointVendor: 'simulator', chargePointModel: 'simulator' });
  record('sent', 'BootNotification');
}

async function sendHeartbeat() {
  await cli.call('Heartbeat', {});
  record('sent', 'Heartbeat');
}

let heartbeatTimer = null;
function restartHeartbeat() {
  clearInterval(heartbeatTimer);
  heartbeatTimer = null;
  const seconds = Number(configValue('HeartbeatInterval'));
  if (seconds > 0) {
    heartbeatTimer = setInterval(() => {
      if (state.connected) background('Heartbeat', sendHeartbeat());
    }, seconds * 1000);
  }
}

async function sendStatus(connectorId, status, errorCode = 'NoError') {
  await cli.call('StatusNotification', { connectorId, errorCode, status, timestamp: new Date().toISOString() });
  const c = state.connectors.get(connectorId);
  if (c) {
    c.status = status;
    c.errorCode = errorCode;
  }
  const fault = status === 'Faulted' ? ` (${errorCode})` : '';
  record('sent', `StatusNotification connector ${connectorId} -> ${status}${fault}`);
  console.log(`[cp] connector ${connectorId} -> ${status}${fault}`);
}

async function authorizeIdTag(idTag) {
  const res = await cli.call('Authorize', { idTag });
  const status = res.idTagInfo?.status ?? 'Unknown';
  record('sent', `Authorize ${idTag} -> ${status}`);
  if (status === 'Accepted') state.authCache.add(idTag);
  return status;
}

// The values this connector can report, for the measurands the site has chosen.
function sampledValues(c, context) {
  const sampledValue = [];
  for (const name of sampledMeasurands(configValue('MeterValuesSampledData'))) {
    if (!Object.hasOwn(MEASURANDS, name)) continue;
    const value = MEASURANDS[name].value(c);
    if (value === null) continue;
    sampledValue.push({ value: String(value), context, measurand: name, unit: MEASURANDS[name].unit });
  }
  return sampledValue;
}

async function sendMeterValues(c, context) {
  const sampledValue = sampledValues(c, context);
  if (!sampledValue.length) return;
  c.lastSample = Date.now();
  const params = { connectorId: c.id, meterValue: [{ timestamp: new Date().toISOString(), sampledValue }] };
  if (c.transactionId) params.transactionId = c.transactionId;
  await cli.call('MeterValues', params);
  const summary = sampledValue.map((v) => `${v.measurand} ${v.value} ${v.unit}`).join(', ');
  record('sent', `MeterValues connector ${c.id} (${context}): ${summary}`);
}

async function startTransaction(connectorId, idTag, { soc, authorize = false } = {}) {
  const c = requireConnector(connectorId);
  if (typeof idTag !== 'string' || !idTag.trim() || idTag.trim().length > 20) {
    throw new CommandError(400, 'Enter an ID tag of up to 20 characters.');
  }
  const tag = idTag.trim();
  if (c.transactionId) throw new CommandError(409, `Connector ${connectorId} already has a transaction.`);
  if (c.availability !== 'Operative' || c.status === 'Faulted' || c.status === 'Unavailable') {
    throw new CommandError(409, `Connector ${connectorId} is not available.`);
  }
  if (c.reservation && c.reservation.idTag !== tag) {
    throw new CommandError(409, `Connector ${connectorId} is reserved for another ID tag.`);
  }
  const reservationId = c.reservation?.reservationId;
  if (authorize) {
    const status = await authorizeIdTag(tag);
    if (status !== 'Accepted') throw new CommandError(403, `The central system returned ${status} for this ID tag.`);
  }

  const startSoc = isFull() ? clampPct(soc ?? DEFAULT_START_SOC) : null;
  const params = { connectorId, idTag: tag, meterStart: Math.round(c.meterWh), timestamp: new Date().toISOString() };
  if (reservationId !== undefined) params.reservationId = reservationId;
  const res = await cli.call('StartTransaction', params);
  const status = res.idTagInfo?.status ?? 'Unknown';
  if (status !== 'Accepted' || !Number.isInteger(res.transactionId)) {
    record('error', `StartTransaction on connector ${connectorId} was not accepted (${status})`);
    throw new CommandError(403, `The central system returned ${status}, so no session started.`);
  }

  const transactionId = res.transactionId;
  c.transactionId = transactionId;
  c.socPct = startSoc;
  state.transactions.set(transactionId, {
    connectorId,
    idTag: tag,
    idTagStatus: status,
    startedAt: new Date().toISOString(),
    meterStartWh: c.meterWh,
    startSoc,
  });
  if (reservationId !== undefined) releaseReservation(c);
  record('sent', `StartTransaction connector ${connectorId}, idTag ${tag} -> transaction ${transactionId} (${status})`);
  console.log('[cp] StartTransaction ->', res);

  if (isFull()) {
    background(`MeterValues connector ${connectorId}`, sendMeterValues(c, 'Transaction.Begin'));
    await sendStatus(connectorId, 'Charging');
  }
  return { transactionId, idTagInfo: res.idTagInfo };
}

async function stopTransaction(transactionId, reason = 'Local') {
  const tx = state.transactions.get(transactionId);
  if (!tx) throw new CommandError(404, 'That transaction is not open in this simulator.');
  const c = state.connectors.get(tx.connectorId);
  const timestamp = new Date().toISOString();
  const params = { transactionId, meterStop: Math.round(c.meterWh), timestamp, reason };
  if (isFull()) {
    const sampledValue = sampledValues(c, 'Transaction.End');
    if (sampledValue.length) params.transactionData = [{ timestamp, sampledValue }];
  }
  const res = await cli.call('StopTransaction', params);
  state.transactions.delete(transactionId);
  c.transactionId = null;
  c.powerW = 0;
  c.currentA = 0;
  c.socPct = null;
  record('sent', `StopTransaction ${transactionId} (${reason}) -> ${res.idTagInfo?.status ?? 'done'}`);
  console.log('[cp] StopTransaction ->', res);

  if (isFull() && ['Charging', 'SuspendedEV', 'SuspendedEVSE'].includes(c.status)) {
    await sendStatus(c.id, 'Finishing');
  }
  if (c.pendingAvailability) {
    const next = c.pendingAvailability;
    c.pendingAvailability = null;
    await applyAvailability(c, next);
  }
  return res;
}

async function applyAvailability(c, wanted) {
  c.availability = wanted;
  if (wanted === 'Inoperative') {
    releaseReservation(c);
    if (c.status !== 'Unavailable') await sendStatus(c.id, 'Unavailable');
  } else if (c.status === 'Unavailable') {
    await sendStatus(c.id, 'Available');
  }
}

// ---- reservations (full-featured EVSE) -------------------------------------

function releaseReservation(c) {
  if (c.reservation) clearTimeout(c.reservation.timer);
  c.reservation = null;
}

function expireReservation(c, reservationId) {
  if (c.reservation?.reservationId !== reservationId) return;
  releaseReservation(c);
  if (c.status === 'Reserved') background(`connector ${c.id} status`, sendStatus(c.id, 'Available'));
}

const isFreeForReservation = (c) =>
  !c.transactionId &&
  !c.reservation &&
  c.availability === 'Operative' &&
  (c.status === 'Available' || c.status === 'Preparing');

// ---- central system -> charge point ----------------------------------------

// Each handler runs only if the current profile supports that message.
function on(method, handler) {
  cli.handle(method, ({ params }) => {
    if (!PROFILE_MESSAGES[state.profile].has(method)) {
      received(method, params, `not in the ${state.profile} profile`);
      throw new RPCNotSupportedError(`${method} is not supported by the ${PROFILES[state.profile].label}.`);
    }
    received(method, params);
    return handler(params);
  });
}

// Core profile

on('ChangeAvailability', ({ connectorId, type }) => {
  if (connectorId !== 0 && !state.connectors.has(connectorId)) return { status: 'Rejected' };
  const wanted = type === 'Inoperative' ? 'Inoperative' : 'Operative';
  const targets = connectorId === 0 ? [...state.connectors.values()] : [state.connectors.get(connectorId)];
  let status = 'Accepted';
  const now = [];
  for (const c of targets) {
    if (c.transactionId) {
      c.pendingAvailability = wanted;
      status = 'Scheduled';
    } else {
      c.pendingAvailability = null;
      now.push(c);
    }
  }
  if (now.length) {
    afterReply('ChangeAvailability', async () => {
      for (const c of now) await applyAvailability(c, wanted);
    });
  }
  return { status };
});

on('ChangeConfiguration', ({ key, value }) => ({ status: applyConfiguration(key, value) }));

on('ClearCache', () => {
  const count = state.authCache.size;
  state.authCache.clear();
  record('info', `Cleared ${count} cached ID tag${count === 1 ? '' : 's'}`);
  return { status: 'Accepted' };
});

on('DataTransfer', ({ vendorId, data }) => {
  if (vendorId !== 'simulator') return { status: 'UnknownVendorId' };
  return { status: 'Accepted', data: data ?? '' };
});

on('GetConfiguration', ({ key }) => {
  const entries = configEntries();
  if (!Array.isArray(key) || key.length === 0) {
    return { configurationKey: entries.map(({ key: k, value, readonly }) => ({ key: k, value, readonly })), unknownKey: [] };
  }
  const configurationKey = [];
  const unknownKey = [];
  for (const k of key) {
    const entry = entries.find((e) => e.key === k);
    if (entry) configurationKey.push({ key: entry.key, value: entry.value, readonly: entry.readonly });
    else unknownKey.push(k);
  }
  return { configurationKey, unknownKey };
});

on('RemoteStartTransaction', ({ connectorId, idTag }) => {
  const pool = connectorId ? [state.connectors.get(connectorId)] : [...state.connectors.values()];
  const c = pool.find(
    (x) =>
      x &&
      !x.transactionId &&
      x.availability === 'Operative' &&
      ['Available', 'Preparing', 'Reserved'].includes(x.status) &&
      (!x.reservation || x.reservation.idTag === idTag),
  );
  if (!c) return { status: 'Rejected' };
  afterReply(`remote start on connector ${c.id}`, async () => {
    if (c.status === 'Available') await sendStatus(c.id, 'Preparing');
    await startTransaction(c.id, idTag, {
      soc: DEFAULT_START_SOC,
      authorize: configValue('AuthorizeRemoteTxRequests') === 'true',
    });
  });
  return { status: 'Accepted' };
});

on('RemoteStopTransaction', ({ transactionId }) => {
  if (!state.transactions.has(transactionId)) return { status: 'Rejected' };
  afterReply(`remote stop of transaction ${transactionId}`, () => stopTransaction(transactionId, 'Remote'));
  return { status: 'Accepted' };
});

on('Reset', ({ type }) => {
  afterReply(`${type} reset`, async () => {
    for (const id of [...state.transactions.keys()]) {
      await stopTransaction(id, type === 'Hard' ? 'HardReset' : 'SoftReset');
    }
    await bootNotification();
    for (const c of state.connectors.values()) {
      releaseReservation(c);
      c.pendingAvailability = null;
      c.errorCode = 'NoError';
      await sendStatus(c.id, c.availability === 'Operative' ? 'Available' : 'Unavailable');
    }
  });
  return { status: 'Accepted' };
});

on('UnlockConnector', ({ connectorId }) => {
  const c = state.connectors.get(connectorId);
  if (!c) return { status: 'UnlockFailed' };
  afterReply(`unlock connector ${connectorId}`, async () => {
    if (c.transactionId) await stopTransaction(c.transactionId, 'UnlockCommand');
    if (c.status === 'Preparing' || c.status === 'Finishing') {
      await sendStatus(c.id, c.availability === 'Operative' ? 'Available' : 'Unavailable');
    }
  });
  return { status: 'Unlocked' };
});

// Reservation profile (full-featured EVSE)

on('ReserveNow', ({ connectorId, expiryDate, idTag, reservationId }) => {
  let c;
  if (connectorId === 0) {
    c = [...state.connectors.values()].find(isFreeForReservation);
    if (!c) return { status: 'Occupied' };
  } else {
    c = state.connectors.get(connectorId);
    if (!c) return { status: 'Rejected' };
    if (c.status === 'Faulted') return { status: 'Faulted' };
    if (c.availability !== 'Operative' || c.status === 'Unavailable') return { status: 'Unavailable' };
    if (c.transactionId || (c.reservation && c.reservation.reservationId !== reservationId)) {
      return { status: 'Occupied' };
    }
  }
  releaseReservation(c);
  const wait = Math.min(MAX_TIMER_MS, Math.max(0, Date.parse(expiryDate) - Date.now()));
  c.reservation = {
    reservationId,
    idTag,
    expiryDate,
    timer: setTimeout(() => expireReservation(c, reservationId), wait),
  };
  background(`connector ${c.id} status`, sendStatus(c.id, 'Reserved'));
  return { status: 'Accepted' };
});

on('CancelReservation', ({ reservationId }) => {
  const c = [...state.connectors.values()].find((x) => x.reservation?.reservationId === reservationId);
  if (!c) return { status: 'Rejected' };
  releaseReservation(c);
  if (c.status === 'Reserved') background(`connector ${c.id} status`, sendStatus(c.id, 'Available'));
  return { status: 'Accepted' };
});

// Local authorization list profile (full-featured EVSE). The list is stored and
// reported; authorization still goes to the central system.

on('SendLocalList', ({ listVersion, updateType, localAuthorizationList = [] }) => {
  if (updateType === 'Full') {
    state.localList.entries = new Map();
  } else if (listVersion <= state.localList.version) {
    return { status: 'VersionMismatch' };
  }
  for (const entry of localAuthorizationList) {
    if (entry.idTagInfo) state.localList.entries.set(entry.idTag, entry.idTagInfo);
    else state.localList.entries.delete(entry.idTag);
  }
  state.localList.version = listVersion;
  return { status: 'Accepted' };
});

on('GetLocalListVersion', () => ({ listVersion: state.localList.version }));

// Firmware management profile (full-featured EVSE). The update is simulated: the
// status steps are reported, and nothing is installed.

async function setFirmwareStatus(status) {
  state.firmwareStatus = status;
  await cli.call('FirmwareStatusNotification', { status });
  record('sent', `FirmwareStatusNotification ${status}`);
}

async function setDiagnosticsStatus(status) {
  state.diagnosticsStatus = status;
  await cli.call('DiagnosticsStatusNotification', { status });
  record('sent', `DiagnosticsStatusNotification ${status}`);
}

on('UpdateFirmware', () => {
  afterReply('firmware update', async () => {
    for (const status of ['Downloading', 'Downloaded', 'Installing', 'Installed']) {
      await setFirmwareStatus(status);
      await delay(1000);
    }
  });
  return {};
});

on('GetDiagnostics', () => {
  afterReply('diagnostics upload', async () => {
    await setDiagnosticsStatus('Uploading');
    await delay(1000);
    await setDiagnosticsStatus('Uploaded');
  });
  return { fileName: 'simulator-diagnostics.zip' };
});

// Remote trigger profile (full-featured EVSE)

on('TriggerMessage', ({ requestedMessage, connectorId }) => {
  if (connectorId !== undefined && connectorId !== 0 && !state.connectors.has(connectorId)) {
    return { status: 'Rejected' };
  }
  const ids = connectorId === undefined ? [...state.connectors.keys()] : [connectorId];
  afterReply(`triggered ${requestedMessage}`, async () => {
    switch (requestedMessage) {
      case 'BootNotification':
        return bootNotification();
      case 'Heartbeat':
        return sendHeartbeat();
      case 'StatusNotification':
        for (const id of ids) {
          const c = state.connectors.get(id);
          await sendStatus(id, c?.status ?? 'Available', c?.errorCode ?? 'NoError');
        }
        return undefined;
      case 'MeterValues':
        for (const id of ids) {
          const c = state.connectors.get(id);
          if (c) await sendMeterValues(c, 'Trigger');
        }
        return undefined;
      case 'DiagnosticsStatusNotification':
        return setDiagnosticsStatus(state.diagnosticsStatus);
      case 'FirmwareStatusNotification':
        return setFirmwareStatus(state.firmwareStatus);
      default:
        return undefined;
    }
  });
  return { status: 'Accepted' };
});

// Smart charging profile (full-featured EVSE). Limits are applied to the simulated
// charging power. Amps are converted to watts at SUPPLY_VOLTS on PHASES phases by default.

on('SetChargingProfile', ({ connectorId, csChargingProfiles: p }) => {
  if (connectorId !== 0 && !state.connectors.has(connectorId)) return { status: 'Rejected' };
  const schedule = p.chargingSchedule;
  const period = [...schedule.chargingSchedulePeriod].sort((a, b) => a.startPeriod - b.startPeriod)[0];
  const watts =
    schedule.chargingRateUnit === 'A' ? period.limit * SUPPLY_VOLTS * (period.numberPhases ?? PHASES) : period.limit;
  state.chargingProfiles = state.chargingProfiles.filter((x) => x.chargingProfileId !== p.chargingProfileId);
  state.chargingProfiles.push({
    connectorId,
    chargingProfileId: p.chargingProfileId,
    purpose: p.chargingProfilePurpose,
    stackLevel: p.stackLevel,
    unit: schedule.chargingRateUnit,
    limit: period.limit,
    watts,
  });
  return { status: 'Accepted' };
});

on('ClearChargingProfile', (req) => {
  const before = state.chargingProfiles.length;
  state.chargingProfiles = state.chargingProfiles.filter(
    (p) =>
      !(
        (req.id === undefined || p.chargingProfileId === req.id) &&
        (req.connectorId === undefined || p.connectorId === req.connectorId) &&
        (req.chargingProfilePurpose === undefined || p.purpose === req.chargingProfilePurpose) &&
        (req.stackLevel === undefined || p.stackLevel === req.stackLevel)
      ),
  );
  return { status: state.chargingProfiles.length < before ? 'Accepted' : 'Unknown' };
});

on('GetCompositeSchedule', ({ connectorId, duration, chargingRateUnit }) => {
  const c = state.connectors.get(connectorId);
  if (!c) return { status: 'Rejected' };
  const unit = chargingRateUnit === 'A' ? 'A' : 'W';
  const watts = Math.min(c.powerKw * 1000, limitW(c.id));
  const limit = unit === 'A' ? round1(watts / (SUPPLY_VOLTS * PHASES)) : Math.round(watts);
  const now = new Date().toISOString();
  return {
    status: 'Accepted',
    connectorId,
    scheduleStart: now,
    chargingSchedule: {
      duration,
      startSchedule: now,
      chargingRateUnit: unit,
      chargingSchedulePeriod: [{ startPeriod: 0, limit }],
    },
  };
});

// Anything else the central system asks for.
cli.handle(({ method, params }) => {
  received(method, params, 'not implemented');
  throw new RPCNotImplementedError(`${method} is not implemented by this simulator.`);
});

// ---- meter physics and periodic meter values -------------------------------

let lastTick = Date.now();

function tick() {
  const now = Date.now();
  const seconds = (now - lastTick) / 1000;
  lastTick = now;

  for (const c of state.connectors.values()) {
    const tx = c.transactionId ? state.transactions.get(c.transactionId) : null;
    if (tx && c.status === 'Charging') {
      const watts = Math.min(c.powerKw * 1000, limitW(c.id));
      c.powerW = watts;
      c.currentA = watts / (SUPPLY_VOLTS * PHASES);
      c.temperatureC = AMBIENT_C + (watts / 1000) * 1.5;
      c.meterWh += (watts * seconds) / 3600;
      if (tx.startSoc !== null) {
        c.socPct = Math.min(100, tx.startSoc + ((c.meterWh - tx.meterStartWh) / BATTERY_WH) * 100);
        if (c.socPct >= 100 && isFull()) {
          // The car is full and stops drawing power.
          c.socPct = 100;
          c.powerW = 0;
          c.currentA = 0;
          c.status = 'SuspendedEV';
          background(`connector ${c.id} status`, sendStatus(c.id, 'SuspendedEV'));
        }
      }
    } else {
      c.powerW = 0;
      c.currentA = 0;
      c.temperatureC = AMBIENT_C;
    }
  }

  if (isFull() && state.connected) {
    const interval = Number(configValue('MeterValueSampleInterval'));
    if (interval > 0) {
      for (const c of state.connectors.values()) {
        if (c.transactionId && now - c.lastSample >= interval * 1000) {
          background(`MeterValues connector ${c.id}`, sendMeterValues(c, 'Sample.Periodic'));
        }
      }
    }
  }
}

// ---- command set (used by the prompt and the control page) -----------------

function setProfile(name) {
  if (!isProfile(name)) throw new CommandError(400, 'Choose basic or full.');
  if (name === state.profile) return;
  if (name === 'basic') {
    for (const c of state.connectors.values()) {
      if (c.reservation) {
        releaseReservation(c);
        if (c.status === 'Reserved') background(`connector ${c.id} status`, sendStatus(c.id, 'Available'));
      }
    }
    state.chargingProfiles = [];
  }
  state.profile = name;
  record('info', `Now acting as the ${PROFILES[name].label}.`);
  console.log(`[cp] profile: ${PROFILES[name].label}`);
}

async function setConnectorStatus(connectorId, status, errorCode) {
  const c = requireConnector(connectorId);
  if (!STATUSES.includes(status) || status === 'Reserved') throw new CommandError(400, 'Unknown status.');
  let code = 'NoError';
  if (status === 'Faulted') {
    code = isFull() && errorCode ? errorCode : 'OtherError';
    if (!ERROR_CODES.includes(code)) throw new CommandError(400, 'Unknown error code.');
  }
  if (c.reservation) releaseReservation(c);
  await sendStatus(c.id, status, code);
}

function setPower(connectorId, powerKw) {
  const c = requireConnector(connectorId);
  if (!Number.isFinite(powerKw) || powerKw < 0.5 || powerKw > 50) {
    throw new CommandError(400, 'Power must be between 0.5 and 50 kW.');
  }
  c.powerKw = powerKw;
  record('info', `Connector ${connectorId} can draw up to ${powerKw} kW`);
}

function snapshot() {
  const finite = (n) => (Number.isFinite(n) ? n : null);
  return {
    identity,
    endpoint,
    connected: state.connected,
    profile: state.profile,
    profiles: Object.entries(PROFILES).map(([id, p]) => ({ id, label: p.label, summary: p.summary })),
    connectorCount,
    statuses: STATUSES.filter((s) => s !== 'Reserved'),
    errorCodes: ERROR_CODES,
    connectors: [...state.connectors.values()].map((c) => ({
      connectorId: c.id,
      status: c.status,
      errorCode: c.errorCode,
      availability: c.availability,
      pendingAvailability: c.pendingAvailability,
      powerKw: c.powerKw,
      meterKwh: Math.round(c.meterWh) / 1000,
      powerW: Math.round(c.powerW),
      currentA: round1(c.currentA),
      socPct: c.socPct === null ? null : Math.round(c.socPct),
      temperatureC: round1(c.temperatureC),
      transactionId: c.transactionId,
      limitW: finite(limitW(c.id)),
      reservation: c.reservation
        ? { reservationId: c.reservation.reservationId, idTag: c.reservation.idTag, expiryDate: c.reservation.expiryDate }
        : null,
    })),
    transactions: [...state.transactions].map(([transactionId, t]) => ({
      transactionId,
      connectorId: t.connectorId,
      idTag: t.idTag,
      startedAt: t.startedAt,
      idTagStatus: t.idTagStatus,
    })),
    config: configEntries(),
    localList: { version: state.localList.version, entries: state.localList.entries.size },
    authCacheSize: state.authCache.size,
    chargingProfiles: state.chargingProfiles.map((p) => ({
      chargingProfileId: p.chargingProfileId,
      connectorId: p.connectorId,
      purpose: p.purpose,
      limit: p.limit,
      unit: p.unit,
    })),
    firmwareStatus: state.firmwareStatus,
    diagnosticsStatus: state.diagnosticsStatus,
    events: state.events.slice(-100).reverse(),
  };
}

const api = {
  isConnected: () => state.connected,
  snapshot,
  setProfile(name) {
    setProfile(name);
    return snapshot();
  },
  async setConnectorStatus(connectorId, status, errorCode) {
    await setConnectorStatus(connectorId, status, errorCode);
    return snapshot();
  },
  setPower(connectorId, powerKw) {
    setPower(connectorId, powerKw);
    return snapshot();
  },
  async startSession(connectorId, idTag, soc) {
    await startTransaction(connectorId, idTag, { soc, authorize: isFull() });
    return snapshot();
  },
  async stopSession(transactionId) {
    await stopTransaction(transactionId, 'Local');
    return snapshot();
  },
  setConfig(key, value) {
    const status = applyConfiguration(key, value);
    if (status !== 'Accepted') throw new CommandError(400, `${key} was not changed (${status}).`);
    return snapshot();
  },
  async sendBoot() {
    await bootNotification();
    return snapshot();
  },
  async sendHeartbeat() {
    await sendHeartbeat();
    return snapshot();
  },
  async sendMeterValues(connectorId) {
    if (!isFull()) throw new CommandError(409, 'Meter values are part of the full-featured EVSE.');
    await sendMeterValues(requireConnector(connectorId), 'Trigger');
    return snapshot();
  },
};

// ---- control page ----------------------------------------------------------

let controlServer = null;

function startControlPage() {
  if (controlPort === 0) return;
  controlServer = createControlApp({ api, port: controlPort }).listen(controlPort, '127.0.0.1', () => {
    console.log(`[cp] control page: http://127.0.0.1:${controlPort}`);
  });
  controlServer.on('error', (err) => {
    console.error(`[cp] control page not started on port ${controlPort}: ${err.message}`);
    controlServer = null;
  });
}

// ---- startup ---------------------------------------------------------------

startControlPage();

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
console.log(`[cp] ${identity} connected to ${endpoint} as the ${PROFILES[state.profile].label}`);

await bootNotification();
await sendStatus(0, 'Available');
for (const id of state.connectors.keys()) {
  await sendStatus(id, 'Available');
}
console.log(`[cp] Reported ${connectorCount} connector(s) as Available`);
restartHeartbeat();
setInterval(tick, METER_TICK_MS);

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
    if (Object.hasOwn(STATUS_ALIASES, cmd)) {
      const c = requireConnector(Number(a));
      await sendStatus(c.id, STATUS_ALIASES[cmd]);
    } else if (cmd === 'start') {
      await startTransaction(Number(a), b, { authorize: false });
    } else if (cmd === 'stop') {
      await stopTransaction(Number(a));
    } else if (cmd === 'profile') {
      setProfile(a);
    } else if (cmd === 'quit') {
      await cli.close();
      process.exit(0);
    } else {
      console.log(
        `Commands: ${Object.keys(STATUS_ALIASES).join(' | ')} <connectorId> | start <connectorId> <idTag> | stop <txId> | profile basic|full | quit`,
      );
    }
  } catch (err) {
    console.error('[cp] Error:', err.message);
    record('error', err.message);
  }
  if (!rl.closed) rl.prompt();
}

rl.on('close', async () => {
  // On piped input, 'close' fires right after all 'line' events are
  // dispatched -- before their queued async handlers have actually run.
  // Let the queue drain first so buffered commands aren't dropped.
  await queue;
  // With no terminal (stdin closed, e.g. run in the background), keep serving the
  // control page; Ctrl+C or a signal still stops the simulator.
  if (controlServer) {
    console.log('[cp] Input closed. The control page is still running; press Ctrl+C to stop.');
    return;
  }
  process.exit(0);
});
