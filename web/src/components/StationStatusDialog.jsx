import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  MenuItem,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { api } from '../api/client.js';
import { useLive } from '../api/live.js';
import { useAuth } from '../context/AuthContext.jsx';
import { ocppStatusLabel } from '../ocppStatus.js';

const METER_TEXT = {
  REPORTING: 'Reports meter readings',
  CONFIGURED: 'Meter set up, waiting for readings',
  NONE: 'No meter reported by this charge point',
  UNKNOWN: 'Not checked yet',
};

const TRIGGERABLE = [
  'MeterValues',
  'Heartbeat',
  'StatusNotification',
  'BootNotification',
  'DiagnosticsStatusNotification',
  'FirmwareStatusNotification',
];

const when = (iso) => (iso ? new Date(iso).toLocaleString() : 'never');

// The latest reading of one measurand, or null when the charge point has not reported it.
function reading(readings, measurand, digits = 0) {
  const r = readings?.[measurand];
  if (!r) return null;
  return Number(r.value).toFixed(digits);
}

export function StationStatusDialog({ stationId, onClose }) {
  const { can } = useAuth();
  const canControl = can('stations.control');
  const base = `/api/admin/station-commands/${stationId}`;

  const [status, setStatus] = useState(null);
  const [config, setConfig] = useState(null);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [holdForm, setHoldForm] = useState({});
  const [trigger, setTrigger] = useState({ requestedMessage: 'MeterValues', connectorId: '' });
  const [edits, setEdits] = useState({});

  async function load() {
    try {
      const { data } = await api.get(`/api/admin/stations/${stationId}/status`);
      setStatus(data);
    } catch {
      setMessage({ kind: 'error', text: 'Could not load the charge point.' });
    }
  }

  async function loadConfig(refresh = false) {
    try {
      const { data } = await api.get(`${base}/configuration`, { params: refresh ? { refresh: 1 } : {} });
      setConfig(data);
      setEdits({});
    } catch (err) {
      setMessage({ kind: 'error', text: err.response?.data?.error ?? 'Could not read the configuration.' });
    }
  }

  useEffect(() => {
    load();
    loadConfig(false);
  }, [stationId]);

  // Connection, connectors and recent events update as the charge point reports them.
  useLive('/api/admin/live', ['station', 'connector', 'stationEvent', 'transaction'], () => load());

  // Runs one command. Commands the charge point must confirm first (ending a session)
  // ask the admin, then run again with the confirmation.
  async function send(path, body = {}, method = 'post') {
    setBusy(true);
    setMessage(null);
    try {
      const res = method === 'delete' ? await api.delete(base + path) : await api[method](base + path, body);
      setMessage({ kind: 'success', text: res.data?.message ?? 'Done.' });
      return res.data;
    } catch (err) {
      const data = err.response?.data ?? {};
      if (data.needsConfirmation) {
        setConfirm({
          text: data.error,
          onConfirm: () => {
            setConfirm(null);
            send(path, { ...body, confirmEndSession: true }, method);
          },
        });
      } else {
        setMessage({ kind: 'error', text: data.error ?? 'The command failed.' });
      }
      return null;
    } finally {
      setBusy(false);
      load();
    }
  }

  async function saveSetting(key) {
    const ok = await send(`/configuration/${key}`, { value: edits[key] }, 'put');
    if (ok) loadConfig(false);
  }

  if (!status) {
    return (
      <Dialog open onClose={onClose} fullWidth maxWidth="md">
        <DialogContent>
          <Typography>Loading…</Typography>
        </DialogContent>
      </Dialog>
    );
  }

  const readOnly = !canControl;

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>
        {status.name} <Typography component="span" variant="body2" fontFamily="monospace" color="text.secondary">{status.identity}</Typography>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ mt: 1 }}>
          {message && <Alert severity={message.kind === 'error' ? 'error' : 'success'} onClose={() => setMessage(null)}>{message.text}</Alert>}

          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
            <Chip size="small" label={status.online ? 'Online' : 'Offline'} color={status.online ? 'success' : 'default'} />
            <Chip size="small" variant="outlined" label={`Last heard ${when(status.lastSeenAt)}`} />
            {status.meterStatus === 'NONE' && <Chip size="small" color="warning" label="No meter" />}
            {status.connectors.some((c) => c.status === 'Faulted') && <Chip size="small" color="error" label="Fault" />}
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {[status.vendor, status.model].filter(Boolean).join(' ') || 'Model not reported'}
            {status.firmwareVersion ? ` · firmware ${status.firmwareVersion}` : ''}
            {status.serialNumber ? ` · serial ${status.serialNumber}` : ''}
            {` · ${METER_TEXT[status.meterStatus] ?? METER_TEXT.UNKNOWN}`}
            {status.firmwareStatus ? ` · firmware update: ${status.firmwareStatus}` : ''}
            {status.diagnosticsStatus ? ` · diagnostics: ${status.diagnosticsStatus}` : ''}
          </Typography>

          <Divider />
          <Typography variant="subtitle2" fontWeight={600}>Connectors</Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Connector</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Readings</TableCell>
                <TableCell>In service</TableCell>
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {status.connectors.map((c) => {
                const form = holdForm[c.connectorId] ?? { idTag: '', minutes: 60, note: '' };
                const setForm = (patch) => setHoldForm({ ...holdForm, [c.connectorId]: { ...form, ...patch } });
                const energy = reading(c.readings, 'Energy.Active.Import.Register');
                const power = reading(c.readings, 'Power.Active.Import');
                const soc = reading(c.readings, 'SoC');
                const temp = reading(c.readings, 'Temperature', 1);
                return (
                  <TableRow key={c.connectorId}>
                    <TableCell>#{c.connectorId}</TableCell>
                    <TableCell>
                      {ocppStatusLabel(c.status)}
                      {c.info || c.errorCode !== 'NoError' ? (
                        <Typography variant="caption" display="block" color="text.secondary">
                          {c.errorCode !== 'NoError' ? c.errorCode : ''}{c.info ? ` ${c.info}` : ''}
                        </Typography>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {energy !== null ? `${(Number(energy) / 1000).toFixed(3)} kWh` : 'No meter reading'}
                      </Typography>
                      {power !== null && <Typography variant="caption" display="block">{power} W</Typography>}
                      {soc !== null && <Typography variant="caption" display="block">Charge {soc}%</Typography>}
                      {temp !== null && <Typography variant="caption" display="block">{temp} °C</Typography>}
                    </TableCell>
                    <TableCell>
                      <Switch
                        size="small"
                        checked={c.operative}
                        disabled={readOnly || busy}
                        onChange={(e) => send(`/connectors/${c.connectorId}/availability`, { operative: e.target.checked })}
                        inputProps={{ 'aria-label': `Connector ${c.connectorId} in service` }}
                      />
                    </TableCell>
                    <TableCell>
                      {c.hold ? (
                        <Stack spacing={0.5} sx={{ alignItems: 'flex-start' }}>
                          <Typography variant="caption">
                            Held for {c.hold.idTag}{c.hold.manual ? '' : ' (waitlist)'} until {when(c.hold.expiresAt)}
                          </Typography>
                          {c.hold.manual && !readOnly && (
                            <Button size="small" onClick={() => send(`/holds/${c.hold.id}`, {}, 'delete')} disabled={busy}>
                              Release hold
                            </Button>
                          )}
                        </Stack>
                      ) : (
                        !readOnly && (
                          <Stack spacing={0.5}>
                            <Stack direction="row" spacing={0.5} alignItems="center">
                              <TextField size="small" placeholder="ID tag" value={form.idTag} onChange={(e) => setForm({ idTag: e.target.value })} inputProps={{ maxLength: 20 }} sx={{ width: 120 }} />
                              <TextField size="small" type="number" value={form.minutes} onChange={(e) => setForm({ minutes: Number(e.target.value) })} sx={{ width: 80 }} inputProps={{ min: 1, max: 480 }} />
                              <Typography variant="caption">min</Typography>
                            </Stack>
                            <Button
                              size="small"
                              disabled={busy || !form.idTag.trim()}
                              onClick={async () => {
                                const ok = await send(`/connectors/${c.connectorId}/hold`, { idTag: form.idTag.trim(), minutes: form.minutes, note: form.note || undefined });
                                if (ok) setHoldForm({ ...holdForm, [c.connectorId]: undefined });
                              }}
                            >
                              Hold this connector
                            </Button>
                          </Stack>
                        )
                      )}
                      {!readOnly && (
                        <Button size="small" color="warning" onClick={() => send(`/connectors/${c.connectorId}/unlock`)} disabled={busy}>
                          Unlock cable
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          <Typography variant="subtitle2" fontWeight={600}>Charging sessions in progress</Typography>
          {status.sessions.length === 0 && <Typography variant="body2" color="text.secondary">None.</Typography>}
          {status.sessions.map((s) => (
            <Stack key={s.id} direction="row" spacing={1} alignItems="center">
              <Typography variant="body2" sx={{ flex: 1 }}>
                Connector {s.connectorId} · ID tag {s.idTag} · since {when(s.startedAt)}
              </Typography>
              {!readOnly && (
                <Button size="small" color="error" onClick={() => send(`/transactions/${s.id}/stop`)} disabled={busy}>
                  Stop session
                </Button>
              )}
            </Stack>
          ))}

          <Divider />
          <Typography variant="subtitle2" fontWeight={600}>Charge point</Typography>
          {!readOnly && (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
              <TextField select size="small" label="Send" value={trigger.requestedMessage} onChange={(e) => setTrigger({ ...trigger, requestedMessage: e.target.value })} sx={{ minWidth: 220 }}>
                {TRIGGERABLE.map((m) => (
                  <MenuItem key={m} value={m}>{m}</MenuItem>
                ))}
              </TextField>
              <TextField select size="small" label="Connector" value={trigger.connectorId} onChange={(e) => setTrigger({ ...trigger, connectorId: e.target.value })} sx={{ minWidth: 130 }}>
                <MenuItem value="">All</MenuItem>
                {status.connectors.map((c) => (
                  <MenuItem key={c.connectorId} value={c.connectorId}>#{c.connectorId}</MenuItem>
                ))}
              </TextField>
              <Button
                variant="outlined"
                disabled={busy || !status.online}
                onClick={() =>
                  send('/trigger', {
                    requestedMessage: trigger.requestedMessage,
                    ...(trigger.connectorId === '' ? {} : { connectorId: Number(trigger.connectorId) }),
                  })
                }
              >
                Ask the charge point
              </Button>
              <Button variant="outlined" disabled={busy || !status.online} onClick={() => send('/clear-cache')}>
                Clear cached ID tags
              </Button>
              <Button variant="outlined" color="warning" disabled={busy || !status.online} onClick={() => send('/reset', { type: 'Soft' })}>
                Restart
              </Button>
            </Stack>
          )}
          {!status.online && <Typography variant="caption" color="text.secondary">The charge point must be connected to receive commands.</Typography>}

          <Divider />
          <Stack direction="row" alignItems="center" spacing={1}>
            <Typography variant="subtitle2" fontWeight={600} sx={{ flex: 1 }}>Configuration</Typography>
            <Button size="small" disabled={busy || !status.online} onClick={() => loadConfig(true)}>
              Read from charge point
            </Button>
          </Stack>
          {config?.fromCache && (
            <Typography variant="caption" color="text.secondary">
              Saved copy{config.at ? ` from ${when(config.at)}` : ''}. Read it again when the charge point is connected.
            </Typography>
          )}
          {config && config.keys.length === 0 && <Typography variant="body2" color="text.secondary">Not read yet.</Typography>}
          {config && config.keys.length > 0 && (
            <Table size="small">
              <TableBody>
                {config.keys.map((k) => {
                  const editable = !readOnly && config.editable.includes(k.key) && !k.readonly;
                  const value = edits[k.key] ?? k.value;
                  return (
                    <TableRow key={k.key}>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                        {k.key}
                        {k.readonly ? ' (read-only)' : ''}
                      </TableCell>
                      <TableCell>
                        {editable ? (
                          <TextField size="small" fullWidth value={value} onChange={(e) => setEdits({ ...edits, [k.key]: e.target.value })} />
                        ) : (
                          <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>{k.value || '—'}</Typography>
                        )}
                      </TableCell>
                      <TableCell align="right">
                        {editable && edits[k.key] !== undefined && edits[k.key] !== k.value && (
                          <Button size="small" onClick={() => saveSetting(k.key)} disabled={busy}>Save</Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}

          <Divider />
          <Typography variant="subtitle2" fontWeight={600}>History</Typography>
          {status.events.length === 0 && <Typography variant="body2" color="text.secondary">Nothing recorded yet.</Typography>}
          {status.events.map((e) => (
            <Typography key={e.id} variant="body2">
              <Typography component="span" variant="caption" color="text.secondary" sx={{ mr: 1 }}>{when(e.at)}</Typography>
              <Typography component="span" variant="caption" fontWeight={600} sx={{ mr: 1 }}>{e.kind}</Typography>
              {e.detail}
            </Typography>
          ))}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>

      <Dialog open={Boolean(confirm)} onClose={() => setConfirm(null)}>
        <DialogTitle>Are you sure?</DialogTitle>
        <DialogContent>
          <Typography>{confirm?.text}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={() => confirm?.onConfirm()}>Confirm</Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
}
