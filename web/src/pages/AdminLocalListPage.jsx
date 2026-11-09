import { useEffect, useState } from 'react';
import { Alert, Button, Container, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

// The site's local authorization list. ACCEPTED tags may charge on a charge point that keeps the list,
// even when it is offline. BLOCKED tags are refused everywhere. Charge points with local list support on
// are sent the list after every change.

export function AdminLocalListPage() {
  const { can } = useAuth();
  const canManage = can('stations.manage');
  const [entries, setEntries] = useState([]);
  const [limit, setLimit] = useState(500);
  const [form, setForm] = useState({ idTag: '', status: 'BLOCKED', note: '' });
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function load() {
    const { data } = await api.get('/api/admin/local-list');
    setEntries(data.data);
    setLimit(data.limit);
  }

  useEffect(() => {
    load().catch(() => setError('The list could not be loaded.'));
  }, []);

  async function run(action, success) {
    setError('');
    setMessage('');
    try {
      await action();
      setMessage(success);
      await load();
    } catch (err) {
      setError(err.response?.data?.error ?? 'The change could not be saved.');
    }
  }

  return (
    <Container maxWidth="md" sx={{ py: 3 }}>
      <Stack spacing={3}>
        <Typography variant="h5" fontWeight={600}>Local authorization list</Typography>
        <Typography variant="body2" color="text.secondary">
          Charge points that keep a local list can decide offline. Use ACCEPTED for cards that may always charge, and
          BLOCKED for lost or stolen cards. Blocked tags are also refused by the server. Up to {limit} entries are sent to a charge point.
          Turn on local list support for each charge point in its settings.
        </Typography>
        {message && <Alert severity="success" onClose={() => setMessage('')}>{message}</Alert>}
        {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}

        {canManage && (
          <Paper sx={{ p: 2 }} component="form" onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await api.post('/api/admin/local-list', form);
              setForm({ idTag: '', status: 'BLOCKED', note: '' });
            }, 'Entry added.');
          }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
              <TextField label="ID tag" size="small" required value={form.idTag} onChange={(e) => setForm({ ...form, idTag: e.target.value })} />
              <TextField select label="Status" size="small" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} sx={{ minWidth: 150 }}>
                <MenuItem value="BLOCKED">Blocked</MenuItem>
                <MenuItem value="ACCEPTED">Accepted</MenuItem>
              </TextField>
              <TextField label="Note" size="small" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} fullWidth />
              <Button type="submit" variant="contained">Add</Button>
            </Stack>
          </Paper>
        )}

        <Paper sx={{ p: 2 }}>
          {entries.length === 0 ? (
            <Typography color="text.secondary">The list is empty.</Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>ID tag</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Note</TableCell>
                  {canManage && <TableCell align="right">Actions</TableCell>}
                </TableRow>
              </TableHead>
              <TableBody>
                {entries.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell sx={{ fontFamily: 'monospace' }}>{e.idTag}</TableCell>
                    <TableCell>{e.status === 'BLOCKED' ? 'Blocked' : 'Accepted'}</TableCell>
                    <TableCell>{e.note ?? '—'}</TableCell>
                    {canManage && (
                      <TableCell align="right">
                        <Button size="small" onClick={() => run(() => api.patch(`/api/admin/local-list/${e.id}`, {
                          status: e.status === 'BLOCKED' ? 'ACCEPTED' : 'BLOCKED',
                        }), 'Entry changed.')}>
                          {e.status === 'BLOCKED' ? 'Accept' : 'Block'}
                        </Button>
                        <Button size="small" color="error" onClick={() => {
                          if (window.confirm(`Remove ${e.idTag} from the list?`)) run(() => api.delete(`/api/admin/local-list/${e.id}`), 'Entry removed.');
                        }}>Remove</Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Paper>
      </Stack>
    </Container>
  );
}
