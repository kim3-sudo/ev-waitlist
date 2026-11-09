import { prisma } from '../db.js';
import { registry } from './stationRegistry.js';
import { callStation, logCommand } from './stationCommands.js';

// The local authorization list. A charge point that keeps the list can decide on its own whether a
// known ID tag may charge, so it still works when the network is down. The list comes from this
// site's entries: ACCEPTED tags are let through, and BLOCKED tags are refused everywhere (the server
// refuses them too, see isBlockedIdTag).

// Most entries a charge point is sent. Chargers commonly accept 100 to 500.
export const LOCAL_LIST_MAX = 500;

export const LOCAL_LIST_STATUSES = ['ACCEPTED', 'BLOCKED'];

// Whether the site has blocked this ID tag. Used by the authorize paths.
export async function isBlockedIdTag(idTag) {
  if (!idTag) return false;
  const entry = await prisma.localListEntry.findFirst({ where: { idTag: String(idTag), status: 'BLOCKED' } });
  return Boolean(entry);
}

// The list as a charge point expects it (OCPP 1.6 shape; the 2.0.1 translation happens in the command layer).
export async function currentLocalList() {
  const rows = await prisma.localListEntry.findMany({ orderBy: [{ idTag: 'asc' }], take: LOCAL_LIST_MAX + 1 });
  return rows.slice(0, LOCAL_LIST_MAX).map((r) => ({ idTag: r.idTag, status: r.status }));
}

// Sends the whole list to one charge point. The version is the current Unix time in seconds, which
// always goes up, so the charge point never mistakes a newer list for an old one.
export async function sendLocalList(station, actorId = null) {
  if (!station.localListEnabled) {
    return { ok: false, message: 'Local list support is turned off for this charge point.' };
  }
  const rows = await prisma.localListEntry.count();
  if (rows > LOCAL_LIST_MAX) {
    return { ok: false, message: `The site has ${rows} entries; a charge point takes at most ${LOCAL_LIST_MAX}.` };
  }
  const entries = await currentLocalList();
  const listVersion = Math.floor(Date.now() / 1000);
  const outcome = await callStation(station, 'SendLocalList', {
    listVersion,
    updateType: 'Full',
    localAuthorizationList: entries.map((e) => ({ idTag: e.idTag, idTagInfo: { status: e.status === 'BLOCKED' ? 'Blocked' : 'Accepted' } })),
  });
  if (outcome.ok) {
    await logCommand(station, actorId, `Sent the local list (${entries.length} entries): ${outcome.result?.status ?? 'no answer'}.`);
  }
  return outcome;
}

// Sends the list to every connected charge point that has the feature on. Called after the list changes.
export async function pushLocalListEverywhere() {
  const stations = await prisma.station.findMany({ where: { localListEnabled: true }, select: { id: true, identity: true, localListEnabled: true, name: true } });
  const results = [];
  for (const station of stations) {
    if (!registry.isConnected(station.identity)) continue;
    results.push({ stationId: station.id, outcome: await sendLocalList(station) });
  }
  return results;
}
