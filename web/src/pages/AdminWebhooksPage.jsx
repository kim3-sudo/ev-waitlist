import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
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

// Webhooks: the server posts events to these addresses, signed with each endpoint's secret.
// The secret is shown once, when an endpoint is created.

const when = (iso) => (iso ? new Date(iso).toLocaleString() : '—');

function NewEndpoint({ eventTypes, onClose, onCreated }) {
  const [url, setUrl] = useState('');
  const [all, setAll] = useState(true);
  const [picked, setPicked] = useState([]);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setError('');
    try {
      const events = all ? '*' : picked;
      const { data } = await api.post('/api/admin/webhooks', { url, events });
      onCreated(data);
    } catch (err) {
      setError(err.response?.data?.error ?? 'The endpoint could not be added.');
    }
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" component="form" onSubmit={submit}>
      <DialogTitle>Add webhook endpoint</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField label="Address (https://)" required value={url} onChange={(e) => setUrl(e.target.value)} helperText="Must be https, and not on a private network." />
          <FormControlLabel control={<Checkbox checked={all} onChange={(e) => setAll(e.target.checked)} />} label="Send every event" />
          {!all && eventTypes.map((t) => (
            <FormControlLabel
              key={t}
              control={<Checkbox checked={picked.includes(t)} onChange={(e) => setPicked(e.target.checked ? [...picked, t] : picked.filter((x) => x !== t))} />}
              label={t}
            />
          ))}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="contained">Add</Button>
      </DialogActions>
    </Dialog>
  );
}

export function AdminWebhooksPage() {
  const [endpoints, setEndpoints] = useState([]);
  const [deliveries, setDeliveries] = useState([]);
  const [eventTypes, setEventTypes] = useState([]);
  const [adding, setAdding] = useState(false);
  const [shown, setShown] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function load() {
    const [e, d] = await Promise.all([api.get('/api/admin/webhooks'), api.get('/api/admin/webhooks/deliveries')]);
    setEndpoints(e.data.data);
    setDeliveries(d.data.data);
  }

  useEffect(() => {
    load().catch(() => setError('Webhooks could not be loaded.'));
    api.get('/api/admin/webhooks/events').then(({ data }) => setEventTypes(data.data)).catch(() => {});
  }, []);

  async function run(action, success) {
    setError('');
    setMessage('');
    try {
      await action();
      setMessage(success);
      await load();
    } catch (err) {
      setError(err.response?.data?.error ?? 'The request failed.');
    }
  }

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Stack spacing={3}>
        <Typography variant="h5" fontWeight={600}>Webhooks</Typography>
        <Typography variant="body2" color="text.secondary">
          The server posts events (for example a paid charge or a fault) to these addresses. Each post carries an
          X-Plugyard-Signature header that the receiver checks with the endpoint's secret. Failed posts are retried
          with growing waits, then given up after ten attempts.
        </Typography>
        {message && <Alert severity="success" onClose={() => setMessage('')}>{message}</Alert>}
        {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
        {shown && (
          <Alert severity="warning" onClose={() => setShown(null)}>
            Copy this signing secret now. It is not shown again: <strong style={{ fontFamily: 'monospace' }}>{shown}</strong>
          </Alert>
        )}

        <Paper sx={{ p: 2 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
            <Typography variant="h6">Endpoints</Typography>
            <Button variant="contained" onClick={() => setAdding(true)}>Add endpoint</Button>
          </Stack>
          {endpoints.length === 0 ? (
            <Typography color="text.secondary">No endpoints yet.</Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Address</TableCell>
                  <TableCell>Events</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {endpoints.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell sx={{ fontFamily: 'monospace' }}>{e.url}</TableCell>
                    <TableCell>{e.events === '*' ? 'All events' : e.events}</TableCell>
                    <TableCell>{e.active ? 'On' : 'Off'}</TableCell>
                    <TableCell align="right">
                      <Button size="small" onClick={() => run(() => api.post(`/api/admin/webhooks/${e.id}/test`), 'A test event is queued.')}>Send test</Button>
                      <Button size="small" onClick={() => run(() => api.patch(`/api/admin/webhooks/${e.id}`, { active: !e.active }), e.active ? 'Endpoint turned off.' : 'Endpoint turned on.')}>
                        {e.active ? 'Turn off' : 'Turn on'}
                      </Button>
                      <Button size="small" color="error" onClick={() => {
                        if (window.confirm('Delete this endpoint? Events not yet delivered to it are dropped.')) {
                          run(() => api.delete(`/api/admin/webhooks/${e.id}`), 'Endpoint deleted.');
                        }
                      }}>Delete</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Paper>

        <Paper sx={{ p: 2 }}>
          <Typography variant="h6" gutterBottom>Recent deliveries</Typography>
          {deliveries.length === 0 ? (
            <Typography color="text.secondary">Nothing has been sent yet.</Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>When</TableCell>
                  <TableCell>Event</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Attempts</TableCell>
                  <TableCell>Last result</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {deliveries.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>{when(d.createdAt)}</TableCell>
                    <TableCell>{d.eventType}</TableCell>
                    <TableCell>{d.status === 'DELIVERED' ? 'Delivered' : d.status === 'FAILED' ? 'Given up' : 'Waiting'}</TableCell>
                    <TableCell>{d.attempts}</TableCell>
                    <TableCell>{d.lastError ?? (d.lastStatusCode ? `HTTP ${d.lastStatusCode}` : '—')}</TableCell>
                    <TableCell align="right">
                      {d.status !== 'DELIVERED' && (
                        <Button size="small" onClick={() => run(() => api.post(`/api/admin/webhooks/deliveries/${d.id}/retry`), 'Queued again.')}>Retry</Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Paper>
      </Stack>

      {adding && (
        <NewEndpoint
          eventTypes={eventTypes}
          onClose={() => setAdding(false)}
          onCreated={async (created) => {
            setAdding(false);
            setShown(created.secret);
            await load();
          }}
        />
      )}
    </Container>
  );
}
