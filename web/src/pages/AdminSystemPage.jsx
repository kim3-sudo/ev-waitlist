import { useEffect, useState } from 'react';
import { Alert, Button, Container, Paper, Stack, TextField, Typography } from '@mui/material';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

// Web addresses and general behavior. Saved values take effect straight away.
export function AdminSystemPage() {
  const { can } = useAuth();
  const canManage = can('system.manage');
  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  function fromResponse(data) {
    return {
      publicUrl: data.values.publicUrl ?? '',
      webUrl: data.values.webUrl ?? '',
      corsOrigin: data.values.corsOrigin ?? '',
      reservationWindowMinutes: String(data.values.reservationWindowMinutes ?? 15),
    };
  }

  useEffect(() => {
    api
      .get('/api/admin/system')
      .then(({ data }) => {
        setSaved(fromResponse(data));
        setForm(fromResponse(data));
      })
      .catch(() => setError('Could not load system settings.'));
  }, []);

  function update(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    setSaving(true);
    try {
      const { data } = await api.put('/api/admin/system', {
        publicUrl: form.publicUrl,
        webUrl: form.webUrl,
        corsOrigin: form.corsOrigin,
        reservationWindowMinutes: Number(form.reservationWindowMinutes),
      });
      setSaved(fromResponse(data));
      setForm(fromResponse(data));
      setMessage('System settings saved.');
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not save system settings.');
    } finally {
      setSaving(false);
    }
  }

  if (!form) {
    return (
      <Container maxWidth="md" sx={{ py: 4 }}>
        {error && <Alert severity="error">{error}</Alert>}
      </Container>
    );
  }

  const publicUrlChanged = saved && form.publicUrl !== saved.publicUrl;

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Typography variant="h5" fontWeight={600} gutterBottom>
        System
      </Typography>
      <Paper variant="outlined" sx={{ p: 3, mt: 2 }}>
        <form onSubmit={handleSubmit}>
          <Stack spacing={3}>
            {error && <Alert severity="error">{error}</Alert>}
            {message && <Alert severity="success">{message}</Alert>}
            {!canManage && <Alert severity="info">You can view these settings, but your role can't change them.</Alert>}

            <TextField
              label="Public address of this server"
              value={form.publicUrl}
              onChange={update('publicUrl')}
              disabled={!canManage}
              helperText="The address charge points and identity providers use to reach this server. Used for single sign-on and Square webhooks."
              fullWidth
            />
            {publicUrlChanged && (
              <Alert severity="warning">
                Changing this breaks single sign-on until you update the identity provider's settings to match. Square's
                webhook URL also changes unless you set one explicitly under Payment providers.
              </Alert>
            )}

            <TextField
              label="Web app address"
              value={form.webUrl}
              onChange={update('webUrl')}
              disabled={!canManage}
              helperText="Where drivers are sent to pay, and where Stripe and Square return them after checkout."
              fullWidth
            />

            <TextField
              label="Allowed web origin"
              value={form.corsOrigin}
              onChange={update('corsOrigin')}
              disabled={!canManage}
              helperText="The address the admin web app is served from. Browsers from any other address can't call the API."
              fullWidth
            />

            <TextField
              label="Reservation window (minutes)"
              type="number"
              value={form.reservationWindowMinutes}
              onChange={update('reservationWindowMinutes')}
              disabled={!canManage}
              helperText="How long the next driver in line has to plug in once their spot opens, from 1 to 1440 minutes."
              slotProps={{ htmlInput: { min: 1, max: 1440 } }}
              sx={{ maxWidth: 260 }}
            />

            {canManage && (
              <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
                <Button type="submit" variant="contained" disabled={saving}>
                  {saving ? 'Saving…' : 'Save system settings'}
                </Button>
              </Stack>
            )}
          </Stack>
        </form>
      </Paper>
    </Container>
  );
}
