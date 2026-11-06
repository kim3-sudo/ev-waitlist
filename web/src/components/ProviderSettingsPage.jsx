import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Chip,
  Container,
  FormControlLabel,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

// One field of a provider's settings. A `secret` is never sent back by the server: once
// saved, the page only says so, and a new value replaces it.
function Field({ field, value, secretSaved, removing, canManage, onChange, onRemove }) {
  if (field.secret) {
    return (
      <Stack spacing={0.5}>
        <TextField
          type="password"
          label={field.label}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={secretSaved && !removing ? 'Saved. Leave blank to keep it.' : undefined}
          helperText={removing ? 'The saved value will be removed when you save.' : field.help}
          autoComplete="new-password"
          disabled={!canManage}
          fullWidth
        />
        {secretSaved && (
          <FormControlLabel
            control={<Checkbox checked={removing} onChange={(e) => onRemove(e.target.checked)} disabled={!canManage} />}
            label="Remove the saved value"
          />
        )}
      </Stack>
    );
  }
  if (field.options) {
    return (
      <TextField
        select
        label={field.label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        helperText={field.help}
        disabled={!canManage}
        fullWidth
      >
        {field.options.map((o) => (
          <MenuItem key={o.value} value={o.value}>
            {o.label}
          </MenuItem>
        ))}
      </TextField>
    );
  }
  return (
    <TextField
      label={field.label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      helperText={field.help}
      disabled={!canManage}
      fullWidth
    />
  );
}

// The shared page for a notification provider: pick a provider, fill in its fields,
// save, and send a test. `config` says which endpoint, providers and fields to use.
export function ProviderSettingsPage({ config }) {
  const { can } = useAuth();
  const canManage = can('integrations.manage');
  const [view, setView] = useState(null);
  const [draft, setDraft] = useState({});
  const [removing, setRemoving] = useState({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null); // { severity, text }
  const [testTo, setTestTo] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  function apply(data) {
    setView(data);
    setDraft({});
    setRemoving({});
  }

  useEffect(() => {
    api
      .get(config.endpoint)
      .then(({ data }) => apply(data))
      .catch(() => setMessage({ severity: 'error', text: 'Could not load these settings.' }));
  }, [config.endpoint]);

  if (!view) return null;

  const value = (key) => (draft[key] !== undefined ? draft[key] : (view.values[key] ?? ''));
  const provider = value(config.providerKey);
  const shownFields = [...config.common, ...(config.byProvider[provider] ?? [])];
  const allFields = [...config.common, ...Object.values(config.byProvider).flat()];

  async function handleSave(e) {
    e.preventDefault();
    setMessage(null);
    setSaving(true);
    const payload = { [config.providerKey]: provider };
    for (const field of allFields) {
      if (field.secret) {
        if (removing[field.key]) payload[field.key] = '';
        else if (draft[field.key]) payload[field.key] = draft[field.key];
      } else {
        payload[field.key] = value(field.key);
      }
    }
    try {
      const { data } = await api.put(config.endpoint, payload);
      apply(data);
      setMessage({ severity: 'success', text: 'Settings saved.' });
    } catch (err) {
      setMessage({ severity: 'error', text: err.response?.data?.error ?? 'Could not save these settings.' });
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const { data } = await api.post(`${config.endpoint}/test`, { to: testTo.trim() });
      setTestResult({ severity: 'success', text: data.message });
    } catch (err) {
      setTestResult({ severity: 'error', text: err.response?.data?.error ?? 'The test was not sent.' });
    } finally {
      setTesting(false);
    }
  }

  const connected = !view.problem;

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Typography variant="h5" fontWeight={600} gutterBottom>
        {config.title}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {config.intro}
      </Typography>
      <Alert severity="info" sx={{ mb: 2 }}>
        {config.notice}
      </Alert>
      {message && (
        <Alert severity={message.severity} sx={{ mb: 2 }} onClose={() => setMessage(null)}>
          {message.text}
        </Alert>
      )}
      {!view.encryptionReady && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Secrets can only be saved once CONFIG_ENCRYPTION_KEY is set in the project .env file.
        </Alert>
      )}
      {view.unreadable.length > 0 && (
        <Alert severity="error" sx={{ mb: 2 }}>
          A saved secret can&apos;t be read, so it has to be entered again.
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 3 }}>
        <form onSubmit={handleSave}>
          <Stack spacing={2.5}>
            <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
              <Typography variant="subtitle1" fontWeight={600}>
                {config.providerHeading}
              </Typography>
              <Chip size="small" label={connected ? 'Connected' : 'Not connected'} color={connected ? 'success' : 'default'} />
            </Stack>
            <TextField
              select
              label={config.providerLabel}
              value={provider}
              onChange={(e) => setDraft((d) => ({ ...d, [config.providerKey]: e.target.value }))}
              disabled={!canManage}
              fullWidth
            >
              {config.providers.map((p) => (
                <MenuItem key={p.value} value={p.value}>
                  {p.label}
                </MenuItem>
              ))}
            </TextField>
            {provider !== config.providers[0].value && view.problem && (
              <Alert severity="warning">{view.problem}</Alert>
            )}
            {shownFields.map((field) => (
              <Field
                key={field.key}
                field={field}
                value={field.secret ? (draft[field.key] ?? '') : value(field.key)}
                secretSaved={Boolean(view.secretsSet[field.key])}
                removing={Boolean(removing[field.key])}
                canManage={canManage}
                onChange={(v) => setDraft((d) => ({ ...d, [field.key]: v }))}
                onRemove={(checked) => setRemoving((r) => ({ ...r, [field.key]: checked }))}
              />
            ))}
            {canManage && (
              <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
                <Button type="submit" variant="contained" disabled={saving}>
                  {saving ? 'Saving…' : 'Save settings'}
                </Button>
              </Stack>
            )}
          </Stack>
        </form>
      </Paper>

      <Paper variant="outlined" sx={{ p: 3, mt: 3 }}>
        <Typography variant="subtitle1" fontWeight={600} gutterBottom>
          Send a test
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          The test uses the settings saved on this page, so save first.
        </Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'flex-start' } }}>
          <TextField
            label={config.testLabel}
            placeholder={config.testPlaceholder}
            value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
            fullWidth
          />
          <Button
            variant="outlined"
            onClick={handleTest}
            disabled={testing || !testTo.trim() || !connected}
            sx={{ minWidth: 130, py: 1.8 }}
          >
            {testing ? 'Sending…' : 'Send test'}
          </Button>
        </Stack>
        {testResult && (
          <Alert severity={testResult.severity} sx={{ mt: 2 }}>
            {testResult.text}
          </Alert>
        )}
      </Paper>
    </Container>
  );
}
