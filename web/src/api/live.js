import { useEffect, useRef } from 'react';
import { api, adminHeaders, resolveApiPath } from './client.js';

// Live updates from the server. Instead of asking for data on a timer, a page opens one
// stream (Server-Sent Events, read with fetch so it can send the admin headers) and is told
// when the data it shows has changed. The page then fetches fresh data over Ajax as usual.
//
// Each notice is { model, ids } where ids is null for "some rows", or the changed row ids.
// After a reconnect the stream sends a null notice (no model): anything may have changed
// while the connection was down, so pages reload.
//
// Several pages can share one stream: subscriptions to the same path reuse a single
// connection, which matters because browsers cap concurrent connections per host.

const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 30_000;
// Statuses that will not change by retrying (signed out, gone). Stop instead of looping.
const FATAL_STATUSES = new Set([401, 403, 404]);

const streams = new Map(); // path -> { listeners: Set, close() }

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function openStream(path, deliver) {
  let stopped = false;
  let controller = null;
  let retryMs = RETRY_MIN_MS;
  let connectedBefore = false;

  // Parses complete frames (ended by a blank line) from the text received so far.
  function handleFrames(buffer) {
    let rest = buffer;
    let end = rest.indexOf('\n\n');
    while (end !== -1) {
      const frame = rest.slice(0, end);
      rest = rest.slice(end + 2);
      let event = 'message';
      let data = '';
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (event === 'change' && data) {
        try {
          deliver(JSON.parse(data));
        } catch {
          // A malformed notice is ignored; the next one still gets through.
        }
      }
      end = rest.indexOf('\n\n');
    }
    return rest;
  }

  async function connect() {
    controller = new AbortController();
    let fatal = false;
    try {
      const res = await fetch(`${api.defaults.baseURL}${resolveApiPath(path)}`, {
        headers: path.startsWith('/api/admin/') ? adminHeaders() : {},
        signal: controller.signal,
        cache: 'no-store',
      });
      if (!res.ok || !res.body) {
        fatal = FATAL_STATUSES.has(res.status);
        throw new Error(`Live stream answered ${res.status}`);
      }
      if (connectedBefore) deliver(null);
      connectedBefore = true;
      retryMs = RETRY_MIN_MS;

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer = handleFrames(buffer + decoder.decode(value, { stream: true }));
      }
    } catch (err) {
      if (stopped || err.name === 'AbortError') return;
      if (fatal) return;
    }
    // The stream ended or failed: try again, backing off so a dead server is not hammered.
    if (stopped) return;
    await sleep(retryMs);
    retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
    if (!stopped) connect();
  }

  connect();
  return () => {
    stopped = true;
    controller?.abort();
  };
}

// Calls `onNotice` for every notice on `path`. Returns a function that stops listening.
export function subscribeLive(path, onNotice) {
  let entry = streams.get(path);
  if (!entry) {
    const listeners = new Set();
    const close = openStream(path, (notice) => {
      for (const listener of [...listeners]) listener(notice);
    });
    entry = { listeners, close };
    streams.set(path, entry);
  }
  entry.listeners.add(onNotice);
  return () => {
    entry.listeners.delete(onNotice);
    if (entry.listeners.size === 0) {
      entry.close();
      if (streams.get(path) === entry) streams.delete(path);
    }
  };
}

// Runs `onChange` when a notice for one of `models` arrives on `path` (and after a
// reconnect). `path` is null to do nothing. `onChange` may be a new function each render.
export function useLive(path, models, onChange, { enabled = true } = {}) {
  const latest = useRef(onChange);
  latest.current = onChange;
  const modelsKey = models.join(',');

  useEffect(() => {
    if (!enabled || !path) return undefined;
    const wanted = new Set(modelsKey.split(',').filter(Boolean));
    return subscribeLive(path, (notice) => {
      if (notice && !wanted.has(notice.model)) return;
      latest.current(notice);
    });
  }, [path, modelsKey, enabled]);
}
