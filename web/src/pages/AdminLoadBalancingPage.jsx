import { useEffect, useState } from 'react';
import { Alert, Button, Checkbox, Container, FormControlLabel, Paper, Stack, TextField, Typography } from '@mui/material';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

// Load balancing: the site's supply is shared between the charge points with smart charging that are
// charging at the same time. Each one gets an equal share, capped at its own maximum.

export function AdminLoadBalancingPage() {
  const { can } = useAuth();
  const canManage = can('stations.manage');
  const [state, setState] = useState(null);
  const [enabled, setEnabled] = useState(false);
  const [kw, setKw] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  function take(data) {
    setState(data);
    setEnabled(data.enabled);
    setKw(data.siteCapacityKw ?? '');
  }

  useEffect(() => {
    api.get('/api/admin/load-balancing').then(({ data }) => take(data)).catch(() => setError('Load balancing could not be loaded.'));
  }, []);

  async function save(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      const { data } = await api.put('/api/admin/load-balancing', { enabled, siteCapacityKw: kw === '' ? null : Number(kw) });
      take(data);
      setMessage('Saved. The charge points are balanced again now.');
    } catch (err) {
      setError(err.response?.data?.error ?? 'The settings could not be saved.');
    }
  }

  async function runNow() {
    setError('');
    setMessage('');
    try {
      const { data } = await api.post('/api/admin/load-balancing/run');
      if (data.skipped) setMessage(data.skipped);
      else setMessage(`Sent ${data.sent} limit(s).${data.overCapacity ? ' The supply cannot give every charging connector the minimum current. Raise the supply or reduce the chargers.' : ''}${data.skippedOffline ? ` ${data.skippedOffline} connector(s) were offline and will be set when they reconnect.` : ''}`);
    } catch (err) {
      setError(err.response?.data?.error ?? 'The balance could not be run.');
    }
  }

  return (
    <Container maxWidth="md" sx={{ py: 3 }}>
      <Stack spacing={3}>
        <Typography variant="h5" fontWeight={600}>Load balancing</Typography>
        <Typography variant="body2" color="text.secondary">
          Turn this on when the site's electrical supply cannot run every charge point at full power at once. Charge points
          with smart charging on share the supply while they charge. A manual limit set on a charge point is overridden while this is on.
        </Typography>
        {message && <Alert severity="success" onClose={() => setMessage('')}>{message}</Alert>}
        {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
        <Paper sx={{ p: 2 }} component="form" onSubmit={save}>
          <Stack spacing={2} sx={{ maxWidth: 420 }}>
            <FormControlLabel control={<Checkbox checked={enabled} disabled={!canManage} onChange={(e) => setEnabled(e.target.checked)} />} label="Share the site supply between charging connectors" />
            <TextField label="Site supply (kW)" type="number" value={kw} disabled={!canManage} onChange={(e) => setKw(e.target.value)} inputProps={{ min: 0, step: 'any' }} helperText="The total the site can supply to its chargers." />
            {state?.chargePointsWithSmartCharging !== undefined && (
              <Typography variant="body2" color="text.secondary">
                {state.chargePointsWithSmartCharging} charge point(s) have smart charging on.
              </Typography>
            )}
            {canManage && (
              <Stack direction="row" spacing={2}>
                <Button type="submit" variant="contained">Save</Button>
                <Button variant="outlined" onClick={runNow}>Balance now</Button>
              </Stack>
            )}
          </Stack>
        </Paper>
      </Stack>
    </Container>
  );
}
