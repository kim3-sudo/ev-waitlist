import { useEffect, useState } from 'react';
import { Alert, FormControlLabel, Stack, Switch, Typography } from '@mui/material';
import { api } from '../api/client.js';

// The admin's own choice of charge point alerts by e-mail. Each admin chooses for
// themselves; nobody else's choice is changed.
export function AlertChoices() {
  const [prefs, setPrefs] = useState(null);
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get('/api/auth/me')
      .then(({ data }) => {
        setEmail(data.email);
        setPrefs({ alertOnFault: data.alertOnFault, alertOffline: data.alertOffline });
      })
      .catch(() => setError('Could not load your alert choices.'));
  }, []);

  async function change(key, value) {
    const previous = prefs;
    setPrefs({ ...prefs, [key]: value });
    setError('');
    try {
      const { data } = await api.put('/api/auth/alerts', { [key]: value });
      setPrefs({ alertOnFault: data.alertOnFault, alertOffline: data.alertOffline });
    } catch {
      setPrefs(previous);
      setError('Could not save that choice.');
    }
  }

  return (
    <Stack spacing={1}>
      {error && <Alert severity="error">{error}</Alert>}
      <FormControlLabel
        control={<Switch checked={Boolean(prefs?.alertOnFault)} disabled={!prefs} onChange={(e) => change('alertOnFault', e.target.checked)} />}
        label="E-mail me when a charge point reports a fault"
      />
      <FormControlLabel
        control={<Switch checked={Boolean(prefs?.alertOffline)} disabled={!prefs} onChange={(e) => change('alertOffline', e.target.checked)} />}
        label="E-mail me when a charge point goes offline or stops reporting"
      />
      <Typography variant="caption" color="text.secondary">
        Alerts go to {email || 'your address'}. They need e-mail to be connected on the E-mail server page.
      </Typography>
    </Stack>
  );
}
