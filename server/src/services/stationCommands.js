import { prisma } from '../db.js';
import { registry } from './stationRegistry.js';
import { OCPP20, fromOcpp20Result, toOcpp20 } from './ocpp20Commands.js';
import { recordStationEvent } from './stationEvents.js';

// Sends one OCPP request to a charge point an admin is looking at. Never throws:
// the result says whether the charge point answered, and what it said.
// Returns { ok: true, result } or { ok: false, offline?, message }.
const DEFAULT_TIMEOUT_MS = 10_000;

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function callStation(station, method, params, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const client = registry.getClient(station.identity);
  if (!client) {
    return { ok: false, offline: true, message: 'The charge point is not connected.' };
  }
  // A charge point that connected with OCPP 2.0.1 gets its own message shape for the same command.
  const twenty = client.protocol === OCPP20;
  let call = { method, params };
  if (twenty) {
    const translated = await toOcpp20(station, method, params);
    if (translated.unsupported) return { ok: false, message: translated.unsupported };
    call = translated;
  }
  try {
    const answer = await withTimeout(client.call(call.method, call.params), timeoutMs);
    return { ok: true, result: twenty ? fromOcpp20Result(method, answer) : answer };
  } catch (err) {
    if (err.message === 'timeout') {
      return { ok: false, message: 'The charge point did not answer in time. Check its network connection.' };
    }
    if (err.rpcErrorCode) {
      return { ok: false, code: err.rpcErrorCode, message: `The charge point refused the request (${err.rpcErrorCode}).` };
    }
    return { ok: false, message: 'The charge point returned an error.' };
  }
}

// Records an admin's command in the station's history.
export async function logCommand(station, actorId, text, { connectorId = null } = {}) {
  return recordStationEvent(station.id, 'COMMAND', text, { connectorId, actorId });
}

// Drops every cached authorization on each connected charge point in this site. Used
// when a driver's personal data is erased. Returns how many charge points were reached.
export async function clearCacheEverywhere() {
  const stations = await prisma.station.findMany({ select: { id: true, identity: true, name: true } });
  let reached = 0;
  for (const station of stations) {
    if (!registry.isConnected(station.identity)) continue;
    const outcome = await callStation(station, 'ClearCache', {});
    if (outcome.ok && outcome.result?.status === 'Accepted') {
      reached += 1;
      await recordStationEvent(station.id, 'COMMAND', 'Cleared cached ID tags after a driver\'s data was erased.');
    }
  }
  return reached;
}
