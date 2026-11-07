import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { api } from '../api/client.js';
import { usePagedList } from '../api/paged.js';
import { LoadMore } from '../components/LoadMore.jsx';
import { useAuth } from '../context/AuthContext.jsx';

const OUTCOME_COLOR = { SUCCESS: 'success', DENIED: 'warning', FAILED: 'error' };
const IP_LABEL = { FULL: 'Full address', TRUNCATED: 'Truncated (IPv4 /24, IPv6 /48)', NONE: 'Not recorded' };
const EMPTY_FILTERS = { action: '', outcome: '', actor: '', target: '', from: '', to: '' };

function formatWhen(value) {
  return value ? new Date(value).toLocaleString() : '—';
}

function actorText(event) {
  if (!event.actorType) return '—';
  if (event.actorLabel) return `${event.actorLabel} (${event.actorType.toLowerCase().replace('_', ' ')})`;
  return event.actorType.toLowerCase().replace('_', ' ');
}

function EventDetails({ event, onClose }) {
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Event {event.seq}: {event.action}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ mt: 1 }}>
          <Typography variant="body2">When: {formatWhen(event.at)}</Typography>
          <Typography variant="body2">Who: {actorText(event)}</Typography>
          <Typography variant="body2">
            Target: {event.targetType ?? '—'} {event.targetLabel ?? event.targetId ?? ''}
          </Typography>
          <Typography variant="body2">Outcome: {event.outcome}{event.reason ? ` · ${event.reason}` : ''}</Typography>
          <Typography variant="body2">Address: {event.ip ?? 'not recorded'}</Typography>
          {event.changes && (
            <Box component="pre" sx={{ p: 1.5, bgcolor: 'action.hover', borderRadius: 1, overflowX: 'auto', fontSize: 12 }}>
              {JSON.stringify(event.changes, null, 2)}
            </Box>
          )}
          <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-all' }}>
            Hash: {event.hash}
            <br />
            Previous: {event.prevHash}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

function SettingsCard({ settings, onSaved }) {
  const [retentionDays, setRetentionDays] = useState(settings.retentionDays);
  const [ipLogging, setIpLogging] = useState(settings.ipLogging);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const dirty = retentionDays !== settings.retentionDays || ipLogging !== settings.ipLogging;

  async function save() {
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const { data } = await api.put('/api/admin/audit/settings', { retentionDays, ipLogging });
      setSaved(true);
      onSaved(data);
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not save the audit settings.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
      <Typography variant="subtitle1" gutterBottom>
        Retention and addresses
      </Typography>
      <Typography variant="body2" color="text.secondary" gutterBottom>
        These apply to the whole installation. Only the installation administrator can change them.
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {saved && !dirty && <Alert severity="success" sx={{ mb: 2 }}>Saved.</Alert>}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
        <TextField
          select
          label="Keep events for"
          value={retentionDays}
          onChange={(e) => setRetentionDays(Number(e.target.value))}
          disabled={!settings.canChange}
          helperText="Events past this age are deleted. Events not yet sent to a SIEM are kept until they are sent."
          sx={{ minWidth: 220 }}
        >
          {settings.retentionOptions.map((days) => (
            <MenuItem key={days} value={days}>
              {days} days{days === 30 ? ' (default)' : ''}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label="Client addresses"
          value={ipLogging}
          onChange={(e) => setIpLogging(e.target.value)}
          disabled={!settings.canChange}
          helperText="Choose less where the law requires it. Not recorded means no address is stored."
          sx={{ minWidth: 260 }}
        >
          {settings.ipLoggingOptions.map((level) => (
            <MenuItem key={level} value={level}>
              {IP_LABEL[level]}
            </MenuItem>
          ))}
        </TextField>
        {settings.canChange && (
          <Button variant="contained" onClick={save} disabled={!dirty || saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        )}
      </Stack>
    </Paper>
  );
}

function ExporterCard({ status }) {
  if (!status) return null;
  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
      <Typography variant="subtitle1" gutterBottom>
        SIEM export
      </Typography>
      {!status.enabled ? (
        <Typography variant="body2" color="text.secondary">
          Not configured. The server sends events to a syslog server or SIEM when AUDIT_SYSLOG_URL is set (for
          example tls://siem.example.com:6514). See the audit log help article for the other settings.
        </Typography>
      ) : (
        <Stack spacing={0.5}>
          <Typography variant="body2">
            Sending to {status.destination} as {status.format.toUpperCase()}:{' '}
            <Chip size="small" label={status.state === 'OK' ? 'working' : 'error'} color={status.state === 'OK' ? 'success' : 'error'} />
          </Typography>
          <Typography variant="body2">Last sent: {formatWhen(status.lastExportAt)}</Typography>
          <Typography variant="body2">Waiting to be sent: {status.backlog}</Typography>
          {status.lastError && <Typography variant="body2" color="error">Last error: {status.lastError}</Typography>}
        </Stack>
      )}
      {status.recordingFailures > 0 && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {status.recordingFailures} audit {status.recordingFailures === 1 ? 'event' : 'events'} could not be recorded since
          the server started. The server log names each one. Last: {status.lastRecordingFailure?.action}.
        </Alert>
      )}
    </Paper>
  );
}

export function AdminAuditPage() {
  const { can } = useAuth();
  const canExport = can('audit.export');
  const [draft, setDraft] = useState(EMPTY_FILTERS);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [settings, setSettings] = useState(null);
  const [exporter, setExporter] = useState(null);
  const [verify, setVerify] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');

  // Only the filters that have a value are sent.
  const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== ''));
  const list = usePagedList('/api/admin/audit/events', { params });

  useEffect(() => {
    api.get('/api/admin/audit/settings').then(({ data }) => setSettings(data)).catch(() => setError('Could not load the audit settings.'));
    if (canExport) {
      api.get('/api/admin/audit/exporter').then(({ data }) => setExporter(data)).catch(() => {});
    }
  }, [canExport]);

  async function checkChain() {
    setVerifying(true);
    setVerify(null);
    try {
      const { data } = await api.get('/api/admin/audit/verify');
      setVerify(data);
    } catch (err) {
      setVerify({ ok: false, problem: err.response?.data?.error ?? 'The check could not run.' });
    } finally {
      setVerifying(false);
    }
  }

  async function downloadCsv() {
    setError('');
    try {
      const res = await api.get('/api/admin/audit/events/export', { params, responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError('The export could not be downloaded.');
    }
  }

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={2} sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h5">Audit log</Typography>
          <Typography variant="body2" color="text.secondary">
            A record of changes, sign-ins, and refused requests. Each entry is linked to the one before it, so an edit or
            deletion can be detected.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" onClick={checkChain} disabled={verifying}>
            {verifying ? 'Checking…' : 'Check the chain'}
          </Button>
          {canExport && (
            <Button variant="contained" onClick={downloadCsv}>
              Download CSV
            </Button>
          )}
        </Stack>
      </Stack>

      {error && <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>{error}</Alert>}
      {list.error && <Alert severity="error" sx={{ mb: 2 }}>{list.error}</Alert>}
      {verify && (
        <Alert severity={verify.ok ? 'success' : 'error'} sx={{ mb: 2 }} onClose={() => setVerify(null)}>
          {verify.ok
            ? `The chain is intact: ${verify.checked} events checked, from event ${verify.anchorSeq} to ${verify.lastSeq}.`
            : `The chain is broken: ${verify.problem}${verify.atSeq ? ` at event ${verify.atSeq}` : ''}. Something in the log was changed or removed.`}
        </Alert>
      )}

      {settings && <SettingsCard settings={settings} onSaved={(next) => setSettings((prev) => ({ ...prev, ...next }))} />}
      {canExport && <ExporterCard status={exporter} />}

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} flexWrap="wrap" useFlexGap>
          <TextField size="small" label="Action starts with" value={draft.action} onChange={(e) => setDraft({ ...draft, action: e.target.value })} placeholder="auth.login" />
          <TextField size="small" select label="Outcome" value={draft.outcome} onChange={(e) => setDraft({ ...draft, outcome: e.target.value })} sx={{ minWidth: 140 }}>
            <MenuItem value="">Any</MenuItem>
            <MenuItem value="SUCCESS">Success</MenuItem>
            <MenuItem value="DENIED">Denied</MenuItem>
            <MenuItem value="FAILED">Failed</MenuItem>
          </TextField>
          <TextField size="small" label="Who" value={draft.actor} onChange={(e) => setDraft({ ...draft, actor: e.target.value })} />
          <TextField size="small" label="Target ID" value={draft.target} onChange={(e) => setDraft({ ...draft, target: e.target.value })} />
          <TextField size="small" type="datetime-local" label="From" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} InputLabelProps={{ shrink: true }} />
          <TextField size="small" type="datetime-local" label="To" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} InputLabelProps={{ shrink: true }} />
          <Stack direction="row" spacing={1} alignItems="center">
            <Button variant="contained" onClick={() => setFilters({ ...draft, from: draft.from ? new Date(draft.from).toISOString() : '', to: draft.to ? new Date(draft.to).toISOString() : '' })}>
              Apply
            </Button>
            <Button onClick={() => { setDraft(EMPTY_FILTERS); setFilters(EMPTY_FILTERS); }}>Clear</Button>
          </Stack>
        </Stack>
      </Paper>

      <Paper variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>When</TableCell>
              <TableCell>Who</TableCell>
              <TableCell>Action</TableCell>
              <TableCell>Target</TableCell>
              <TableCell>Outcome</TableCell>
              <TableCell>Address</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {list.items.length === 0 && !list.loading && (
              <TableRow>
                <TableCell colSpan={7}>
                  <Typography variant="body2" color="text.secondary">No events match.</Typography>
                </TableCell>
              </TableRow>
            )}
            {list.items.map((event) => (
              <TableRow key={event.id} hover>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatWhen(event.at)}</TableCell>
                <TableCell>{actorText(event)}</TableCell>
                <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{event.action}</TableCell>
                <TableCell>{event.targetLabel ?? event.targetId ?? '—'}</TableCell>
                <TableCell>
                  <Chip size="small" label={event.outcome.toLowerCase()} color={OUTCOME_COLOR[event.outcome] ?? 'default'} />
                </TableCell>
                <TableCell>{event.ip ?? '—'}</TableCell>
                <TableCell align="right">
                  <Button size="small" onClick={() => setDetail(event)}>Details</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>
      <LoadMore hasMore={list.hasMore} loading={list.loading} onLoadMore={list.loadMore} />

      {detail && <EventDetails event={detail} onClose={() => setDetail(null)} />}
    </Container>
  );
}
