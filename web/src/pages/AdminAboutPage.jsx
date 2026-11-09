import { useEffect, useState } from 'react';
import { Container, Paper, Typography, TextField, Button, Stack, Alert } from '@mui/material';
import { api } from '../api/client.js';
import { useSettings } from '../context/SettingsContext.jsx';

// The text boxes hold one entry per line; blank lines are dropped on save.
const toLines = (list) => (list ?? []).join('\n');
const fromLines = (text) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

// Help details for drivers: the e-mail addresses, phone numbers and contact form that the
// waitlist's Help tab shows. Saved as one settings value.
export function AdminAboutPage() {
  const { settings, loaded, refresh } = useSettings();
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (loaded && !form) {
      const help = settings.helpContacts ?? {};
      setForm({
        emails: toLines(help.emails),
        phones: toLines(help.phones),
        contactFormUrl: help.contactFormUrl ?? '',
      });
    }
  }, [loaded, settings, form]);

  function update(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess(false);
    setSaving(true);
    try {
      await api.put('/api/admin/settings', {
        helpContacts: {
          emails: fromLines(form.emails),
          phones: fromLines(form.phones),
          contactFormUrl: form.contactFormUrl.trim(),
        },
      });
      await refresh();
      setSuccess(true);
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not save the About details.');
    } finally {
      setSaving(false);
    }
  }

  if (!form) return null;

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Typography variant="h5" fontWeight={600} gutterBottom>
        About
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Who drivers contact for help. These appear in the Help tab when a driver joins a waitlist or starts charging.
      </Typography>

      <Paper variant="outlined" sx={{ p: 3, mt: 2 }}>
        <form onSubmit={handleSubmit}>
          <Stack spacing={3}>
            {error && <Alert severity="error">{error}</Alert>}
            {success && <Alert severity="success">About details saved.</Alert>}

            <TextField
              label="E-mail addresses"
              helperText="One per line, for example support@example.com"
              value={form.emails}
              onChange={update('emails')}
              multiline
              minRows={2}
              fullWidth
            />

            <TextField
              label="Phone numbers"
              helperText="One per line. Include the country code, for example +1 555 123 4567."
              value={form.phones}
              onChange={update('phones')}
              multiline
              minRows={2}
              fullWidth
            />

            <TextField
              label="Contact form link"
              helperText="Optional. A full web address, starting with https://"
              value={form.contactFormUrl}
              onChange={update('contactFormUrl')}
              fullWidth
            />

            <Stack direction="row">
              <Button type="submit" variant="contained" disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </Stack>
          </Stack>
        </form>
      </Paper>
    </Container>
  );
}
