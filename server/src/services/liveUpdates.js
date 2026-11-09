import { EventEmitter } from 'node:events';
import { currentTenantId } from '../tenancy/context.js';

// Live updates. When data changes, the server pushes a short notice down an open
// Server-Sent Events stream, and the page fetches the data it needs over Ajax. Pages no
// longer ask on a timer.
//
// A notice names the model and the row ids that changed. It never carries the data, so a
// stream only tells a client that something changed. Notices for one site and model that
// arrive close together are sent as one.

const COALESCE_MS = 150;
const HEARTBEAT_MS = 20_000;

const bus = new EventEmitter();
bus.setMaxListeners(0);

// Notices waiting to be sent, keyed by site and model.
const pending = new Map();

// Records that rows of `model` changed in `tenantId` (the current site by default).
// `id` is the changed row, or null when the change covers several rows.
export function publishChange(model, id = null, tenantId = currentTenantId()) {
  const key = `${tenantId}\u0000${model}`;
  let entry = pending.get(key);
  if (!entry) {
    entry = { tenantId, model, all: false, ids: new Set() };
    pending.set(key, entry);
    setTimeout(() => flush(key), COALESCE_MS).unref?.();
  }
  if (id === null || id === undefined) entry.all = true;
  else entry.ids.add(String(id));
}

function flush(key) {
  const entry = pending.get(key);
  pending.delete(key);
  if (!entry) return;
  bus.emit('change', {
    tenantId: entry.tenantId,
    model: entry.model,
    // null means "some rows of this model"; otherwise the list of changed row ids.
    ids: entry.all ? null : [...entry.ids],
  });
}

// Opens an event stream on `req`/`res`. `tenantId` limits the stream to one site, or null
// for every site. `match(notice)` decides which notices this stream gets.
export function openLiveStream(req, res, { tenantId = null, match = () => true } = {}) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Stops a reverse proxy from holding the stream back until it closes.
    'X-Accel-Buffering': 'no',
  });
  res.write('event: ready\ndata: {}\n\n');

  const listener = (notice) => {
    if (tenantId !== null && notice.tenantId !== tenantId) return;
    if (!match(notice)) return;
    res.write(`event: change\ndata: ${JSON.stringify({ model: notice.model, ids: notice.ids })}\n\n`);
  };
  bus.on('change', listener);

  // Comments keep idle connections open through proxies and tell a dead client apart.
  const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
  heartbeat.unref?.();

  res.on('close', () => {
    clearInterval(heartbeat);
    bus.off('change', listener);
  });
}
