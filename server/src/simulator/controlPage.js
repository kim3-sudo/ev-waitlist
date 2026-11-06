// The simulator's control page: an HTTP API for the charge point simulator and the
// HTML page that drives it. It only listens on 127.0.0.1, and it refuses requests
// from any other web origin, so an unrelated site open in the browser can't use it.
import express from 'express';

// An error the page can show. The status is the HTTP status to answer with.
export class CommandError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// `api` is the simulator's command set (see chargePoint.js). Each method returns
// the new snapshot, or throws a CommandError (or any other error, reported as 502).
export function createControlApp({ api, port }) {
  const app = express();
  app.use(express.json({ limit: '4kb' }));

  app.use((req, res, next) => {
    const origin = req.get('Origin');
    if (origin && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) {
      return res.status(403).json({ error: 'Requests must come from the control page.' });
    }
    next();
  });

  const wrap = (fn, { needsConnection = false } = {}) => async (req, res) => {
    try {
      if (needsConnection && !api.isConnected()) {
        throw new CommandError(409, 'Not connected to the central system yet.');
      }
      res.json(await fn(req.body ?? {}));
    } catch (err) {
      if (err instanceof CommandError) return res.status(err.status).json({ error: err.message });
      res.status(502).json({ error: `The central system did not answer: ${err.message}` });
    }
  };

  app.get('/', (_req, res) => res.type('html').send(CONTROL_PAGE));
  app.get('/api/state', (_req, res) => res.json(api.snapshot()));

  app.post(
    '/api/profile',
    wrap(async (body) => api.setProfile(body.profile)),
  );
  app.post(
    '/api/status',
    wrap(async (body) => api.setConnectorStatus(Number(body.connectorId), body.status, body.errorCode), {
      needsConnection: true,
    }),
  );
  app.post(
    '/api/power',
    wrap(async (body) => api.setPower(Number(body.connectorId), Number(body.powerKw))),
  );
  app.post(
    '/api/start',
    wrap(
      async (body) => api.startSession(Number(body.connectorId), body.idTag, body.soc === undefined ? undefined : Number(body.soc)),
      { needsConnection: true },
    ),
  );
  app.post(
    '/api/stop',
    wrap(async (body) => api.stopSession(Number(body.transactionId)), { needsConnection: true }),
  );
  app.post(
    '/api/config',
    wrap(async (body) => api.setConfig(body.key, body.value)),
  );
  app.post(
    '/api/boot',
    wrap(async () => api.sendBoot(), { needsConnection: true }),
  );
  app.post(
    '/api/heartbeat',
    wrap(async () => api.sendHeartbeat(), { needsConnection: true }),
  );
  app.post(
    '/api/meter-values',
    wrap(async (body) => api.sendMeterValues(Number(body.connectorId)), { needsConnection: true }),
  );

  return app;
}

// Plain HTML and script, no build step, in the style of the SAML simulator page.
// Every value from the server is written with textContent, never as HTML.
const CONTROL_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Charge point simulator</title>
<style>
  :root { --bg: #f5f6f8; --card: #ffffff; --text: #1d2330; --muted: #5f6878; --line: #d9dde5; --accent: #1d6fdc; --ok: #1e8a4c; --bad: #c62828; }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) { --bg: #14171d; --card: #1e232c; --text: #e7eaf0; --muted: #9aa3b2; --line: #343b48; --accent: #6aa8ff; --ok: #4cc27f; --bad: #ff7b7b; }
  }
  :root[data-theme="dark"] { --bg: #14171d; --card: #1e232c; --text: #e7eaf0; --muted: #9aa3b2; --line: #343b48; --accent: #6aa8ff; --ok: #4cc27f; --bad: #ff7b7b; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 1000px; margin: 0 auto; padding: 24px 16px 48px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 0 0 12px; }
  .muted { color: var(--muted); font-size: 14px; }
  .grid { display: grid; gap: 16px; grid-template-columns: 1fr; }
  @media (min-width: 800px) { .grid { grid-template-columns: 1fr 1fr; } .wide { grid-column: 1 / -1; } }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 16px; min-width: 0; }
  .pill { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 13px; border: 1px solid var(--line); }
  .pill.ok { color: var(--ok); border-color: var(--ok); }
  .pill.bad { color: var(--bad); border-color: var(--bad); }
  .connector { border-top: 1px solid var(--line); padding: 12px 0; }
  .connector:first-of-type { border-top: 0; padding-top: 0; }
  .readings { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 14px; margin-top: 6px; }
  .buttons { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  button { font: inherit; font-size: 13px; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--line); background: var(--card); color: var(--text); cursor: pointer; }
  button:hover:not(:disabled) { border-color: var(--accent); }
  button:disabled { opacity: 0.5; cursor: default; }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  button.current { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); font-weight: 600; }
  input, select { font: inherit; font-size: 14px; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--line); background: var(--bg); color: var(--text); max-width: 100%; }
  input.short { width: 90px; }
  .form { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 8px; }
  .row { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 8px 0; border-top: 1px solid var(--line); }
  .row:first-of-type { border-top: 0; }
  .log { font: 12.5px/1.5 ui-monospace, Menlo, Consolas, monospace; max-height: 380px; overflow: auto; }
  .log div { padding: 3px 0; border-bottom: 1px dashed var(--line); word-break: break-word; }
  .log .time { color: var(--muted); margin-right: 8px; }
  .log .dir { font-weight: 600; margin-right: 8px; }
  .profile { display: grid; gap: 8px; grid-template-columns: 1fr; }
  @media (min-width: 600px) { .profile { grid-template-columns: 1fr 1fr; } }
  .profile .option { border: 1px solid var(--line); border-radius: 8px; padding: 10px; }
  .profile .option.current { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  td { padding: 6px 4px; border-top: 1px solid var(--line); vertical-align: middle; }
  td.key { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12.5px; word-break: break-all; }
  .msg { min-height: 1.4em; font-size: 14px; margin-top: 8px; }
  .msg.bad { color: var(--bad); }
  .msg.ok { color: var(--ok); }
  .hidden { display: none !important; }
</style>
</head>
<body>
<main>
  <h1>Charge point simulator</h1>
  <p class="muted" id="identity"></p>

  <div class="grid">
    <section class="card wide">
      <h2>EVSE profile</h2>
      <div class="profile" id="profiles"></div>
      <p class="muted" style="margin-bottom:0">Switching takes effect at once. The central system sees only the messages that profile supports; other requests get a NotSupported reply.</p>
    </section>

    <section class="card">
      <h2>Connection</h2>
      <p><span class="pill" id="connection"></span></p>
      <p class="muted" id="endpoint"></p>
      <div class="buttons">
        <button type="button" id="boot-button">Send BootNotification</button>
        <button type="button" id="heartbeat-button">Send Heartbeat</button>
      </div>
    </section>

    <section class="card">
      <h2>Start a session</h2>
      <p class="muted" id="start-note"></p>
      <div class="form">
        <select id="start-connector" aria-label="Connector"></select>
        <input id="start-tag" type="text" maxlength="20" placeholder="ID tag" aria-label="ID tag">
        <input id="start-soc" class="short full-only" type="number" min="0" max="100" step="1" value="20" aria-label="Starting state of charge, percent">
        <span class="muted full-only">% charge</span>
        <button class="primary" id="start-button" type="button">Start</button>
      </div>
      <h2 style="margin-top:16px">Open transactions</h2>
      <div id="transactions"></div>
    </section>

    <section class="card wide">
      <h2>Connectors</h2>
      <div id="connectors"></div>
    </section>

    <section class="card">
      <h2>Configuration</h2>
      <p class="muted">Keys the central system can read and change with GetConfiguration and ChangeConfiguration.</p>
      <div id="config"></div>
    </section>

    <section class="card full-only">
      <h2>Smart charging and local list</h2>
      <div id="smart"></div>
    </section>

    <section class="card full-only">
      <h2>Firmware and diagnostics</h2>
      <div id="firmware"></div>
    </section>

    <section class="card wide">
      <h2>Log</h2>
      <div class="log" id="log"></div>
    </section>
  </div>
  <p class="msg" id="message" role="status"></p>
</main>
<script>
(function () {
  var busy = false;
  var lastState = null;
  var STATUS_NOTE = {
    basic: 'Sends StartTransaction. Set the connector to Charging yourself, as a basic charge point needs.',
    full: 'Sends Authorize, then StartTransaction. Once accepted, the connector goes to Charging and the car draws power.'
  };
  var ERROR_NOTE = 'Choose the error to report when you set a connector to Faulted.';
  var el = function (id) { return document.getElementById(id); };

  // Builds an element with text content only.
  function node(tag, props, children) {
    var n = document.createElement(tag);
    if (props) Object.keys(props).forEach(function (k) {
      if (k === 'className') n.className = props[k];
      else if (k === 'onclick') n.onclick = props[k];
      else if (k === 'disabled') n.disabled = props[k];
      else if (k === 'type') n.type = props[k];
      else if (k === 'value') n.value = props[k];
      else n.setAttribute(k, props[k]);
    });
    (children || []).forEach(function (c) {
      if (c === null || c === undefined) return;
      n.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
    return n;
  }

  function say(text, kind) {
    var m = el('message');
    m.textContent = text || '';
    m.className = 'msg' + (kind ? ' ' + kind : '');
  }

  function time(iso) { return new Date(iso).toLocaleTimeString(); }
  function dash(v, unit) { return v === null || v === undefined ? '-' : v + (unit ? ' ' + unit : ''); }

  function send(path, body, okText) {
    busy = true;
    return fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) throw new Error(data.error || 'Request failed.');
        return data;
      });
    }).then(function (data) {
      busy = false;
      say(okText || '', okText ? 'ok' : '');
      render(data);
      return data;
    }, function (err) {
      busy = false;
      say(err.message, 'bad');
      refresh();
      return null;
    });
  }

  function refresh() {
    return fetch('/api/state').then(function (r) { return r.json(); }).then(render).catch(function () {
      say('The simulator stopped responding. Check the terminal.', 'bad');
    });
  }

  function isFull(s) { return s.profile === 'full'; }

  function render(s) {
    lastState = s;
    var full = isFull(s);
    el('identity').textContent = 'Identity ' + s.identity + ' · ' + s.connectorCount + ' connector' + (s.connectorCount === 1 ? '' : 's');
    el('endpoint').textContent = 'Central system: ' + s.endpoint;
    var pill = el('connection');
    pill.textContent = s.connected ? 'Connected' : 'Not connected';
    pill.className = 'pill ' + (s.connected ? 'ok' : 'bad');
    el('start-note').textContent = STATUS_NOTE[s.profile];
    document.querySelectorAll('.full-only').forEach(function (n) { n.classList.toggle('hidden', !full); });
    el('boot-button').disabled = busy || !s.connected;
    el('heartbeat-button').disabled = busy || !s.connected;

    // Profile choice
    var profiles = el('profiles');
    profiles.textContent = '';
    s.profiles.forEach(function (p) {
      var current = p.id === s.profile;
      profiles.appendChild(node('div', { className: 'option' + (current ? ' current' : '') }, [
        node('strong', null, [p.label]),
        node('p', { className: 'muted', style: 'margin:4px 0 8px' }, [p.summary]),
        node('button', {
          type: 'button',
          className: current ? 'current' : '',
          disabled: busy || current,
          onclick: function () { say(''); send('/api/profile', { profile: p.id }, 'Now acting as the ' + p.label + '.'); }
        }, [current ? 'Current profile' : 'Use ' + p.label.toLowerCase()])
      ]));
    });

    // Connectors
    var connectors = el('connectors');
    connectors.textContent = '';
    s.connectors.forEach(function (c) {
      var errSelect = node('select', { 'aria-label': 'Error code for connector ' + c.connectorId, className: 'full-only' + (full ? '' : ' hidden') },
        s.errorCodes.map(function (code) {
          return node('option', { value: code }, [code]);
        }));
      errSelect.value = c.errorCode && c.errorCode !== 'NoError' ? c.errorCode : 'OtherError';
      var faultPick = errSelect;
      var buttons = s.statuses.map(function (status) {
        var onclick = function () {
          say('');
          var code = status === 'Faulted' ? (full ? faultPick.value : 'OtherError') : undefined;
          send('/api/status', { connectorId: c.connectorId, status: status, errorCode: code }, 'Connector ' + c.connectorId + ' set to ' + status + '.');
        };
        return node('button', {
          type: 'button',
          className: c.status === status ? 'current' : '',
          disabled: busy || !s.connected,
          onclick: onclick
        }, [status]);
      });
      var tags = [];
      if (c.availability === 'Inoperative') tags.push('Out of service');
      if (c.pendingAvailability) tags.push('Out of service after the session');
      if (c.reservation) tags.push('Reserved for ' + c.reservation.idTag + ' until ' + time(c.reservation.expiryDate));
      var readings = [node('span', null, ['Meter ' + dash(c.meterKwh, 'kWh')])];
      if (full) {
        readings.push(node('span', null, ['Power ' + dash(c.powerW, 'W')]));
        readings.push(node('span', null, ['Current ' + dash(c.currentA, 'A')]));
        readings.push(node('span', null, ['Charge ' + dash(c.socPct, '%')]));
        readings.push(node('span', null, ['Temperature ' + dash(c.temperatureC, 'C')]));
        readings.push(node('span', null, ['Limit ' + dash(c.limitW, 'W')]));
      }
      var powerInput = node('input', { type: 'number', min: '0.5', max: '50', step: '0.1', value: String(c.powerKw), className: 'short', 'aria-label': 'Charging power, kW' });
      connectors.appendChild(node('div', { className: 'connector' }, [
        node('div', null, [
          node('strong', null, ['Connector ' + c.connectorId]),
          ' ',
          node('span', { className: 'muted' }, [c.status ? 'Reported ' + c.status : 'Not reported yet']),
          c.status === 'Faulted' ? node('span', { className: 'muted' }, [' (' + c.errorCode + ')']) : null
        ]),
        tags.length ? node('div', { className: 'muted' }, [tags.join(' · ')]) : null,
        node('div', { className: 'buttons' }, buttons),
        node('div', { className: 'form' }, [
          node('span', { className: 'muted' }, ['Fault to report:']),
          errSelect,
          node('span', { className: 'muted' }, ['Car draws up to']),
          powerInput,
          node('span', { className: 'muted' }, ['kW']),
          node('button', {
            type: 'button',
            disabled: busy,
            onclick: function () {
              send('/api/power', { connectorId: c.connectorId, powerKw: Number(powerInput.value) }, 'Connector ' + c.connectorId + ' power set.');
            }
          }, ['Set power'])
        ]),
        node('div', { className: 'readings' }, readings)
      ]));
    });
    if (full) {
      connectors.appendChild(node('p', { className: 'muted full-only' }, [ERROR_NOTE]));
    }

    // Start-session connector choice
    var select = el('start-connector');
    var current = select.value;
    select.textContent = '';
    s.connectors.forEach(function (c) {
      select.appendChild(node('option', { value: String(c.connectorId) }, ['Connector ' + c.connectorId]));
    });
    if (current) select.value = current;
    el('start-button').disabled = busy || !s.connected;

    // Transactions
    var tx = el('transactions');
    tx.textContent = '';
    if (!s.transactions.length) tx.appendChild(node('p', { className: 'muted' }, ['No open transactions.']));
    s.transactions.forEach(function (t) {
      tx.appendChild(node('div', { className: 'row' }, [
        node('div', null, [
          node('strong', null, ['Transaction ' + t.transactionId]),
          ' connector ' + t.connectorId + ', ID tag ' + t.idTag,
          node('div', { className: 'muted' }, ['Started ' + time(t.startedAt) + ' · ' + t.idTagStatus])
        ]),
        node('button', {
          type: 'button',
          disabled: busy || !s.connected,
          onclick: function () { say(''); send('/api/stop', { transactionId: t.transactionId }, 'Transaction ' + t.transactionId + ' stopped.'); }
        }, ['Stop'])
      ]));
    });

    // Configuration
    var cfg = el('config');
    cfg.textContent = '';
    var table = node('table', null, []);
    s.config.forEach(function (k) {
      var input = node('input', { value: k.value, 'aria-label': k.key, disabled: k.readonly ? true : false, className: 'wide-input' });
      var save = node('button', {
        type: 'button',
        disabled: k.readonly || busy,
        onclick: function () { say(''); send('/api/config', { key: k.key, value: input.value }, k.key + ' saved.'); }
      }, ['Save']);
      table.appendChild(node('tr', null, [
        node('td', { className: 'key' }, [k.key + (k.readonly ? ' (read-only)' : '')]),
        node('td', null, [input]),
        node('td', null, [save])
      ]));
    });
    cfg.appendChild(table);

    // Smart charging and local list
    var smart = el('smart');
    smart.textContent = '';
    if (!s.chargingProfiles.length) {
      smart.appendChild(node('p', { className: 'muted' }, ['No charging profiles set.']));
    }
    s.chargingProfiles.forEach(function (p) {
      smart.appendChild(node('div', { className: 'row' }, [
        node('div', null, [
          node('strong', null, ['Profile ' + p.chargingProfileId]),
          ' connector ' + p.connectorId + ', ' + p.purpose + ', limit ' + p.limit + ' ' + p.unit
        ])
      ]));
    });
    smart.appendChild(node('p', { className: 'muted' }, [
      'Local list version ' + s.localList.version + ', ' + s.localList.entries + ' ID tag' + (s.localList.entries === 1 ? '' : 's') + '. Cached ID tags: ' + s.authCacheSize + '.'
    ]));

    // Firmware and diagnostics
    el('firmware').textContent = '';
    el('firmware').appendChild(node('p', null, ['Firmware status: ' + s.firmwareStatus]));
    el('firmware').appendChild(node('p', null, ['Diagnostics status: ' + s.diagnosticsStatus]));
    el('firmware').appendChild(node('p', { className: 'muted' }, [
      'The central system starts these with UpdateFirmware and GetDiagnostics. The simulator reports each step.'
    ]));

    // Log
    var log = el('log');
    log.textContent = '';
    if (!s.events.length) log.appendChild(node('div', { className: 'muted' }, ['Nothing yet.']));
    var labels = { sent: '→ sent', received: '← received', error: '! error', info: 'i' };
    s.events.forEach(function (e) {
      log.appendChild(node('div', null, [
        node('span', { className: 'time' }, [time(e.at)]),
        node('span', { className: 'dir' }, [labels[e.direction] || e.direction]),
        e.text
      ]));
    });
  }

  el('start-button').onclick = function () {
    say('');
    var tag = el('start-tag').value.trim();
    if (!tag) { say('Enter an ID tag first.', 'bad'); return; }
    var body = { connectorId: Number(el('start-connector').value), idTag: tag };
    if (lastState && isFull(lastState)) body.soc = Number(el('start-soc').value);
    send('/api/start', body, 'Started a session with ID tag ' + tag + '.').then(function (data) {
      if (data) el('start-tag').value = '';
    });
  };
  el('boot-button').onclick = function () { say(''); send('/api/boot', {}, 'Sent BootNotification.'); };
  el('heartbeat-button').onclick = function () { say(''); send('/api/heartbeat', {}, 'Sent Heartbeat.'); };

  // Don't redraw while the user is typing into a field, or the typing is lost.
  function editing() {
    var a = document.activeElement;
    return !!a && (a.tagName === 'INPUT' || a.tagName === 'SELECT');
  }

  refresh();
  setInterval(function () { if (!busy && !editing()) refresh(); }, 1500);
})();
</script>
</body>
</html>`;
