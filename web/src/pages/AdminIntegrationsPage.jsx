import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Chip,
  Container,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

// Each provider's fields. `secret` fields are never shown again once saved:
// the server only says whether a value is saved.
const PROVIDERS = [
  {
    key: 'STRIPE',
    name: 'Stripe',
    guide: '/help/stripe-setup',
    fields: [
      { key: 'stripe.secretKey', label: 'Secret key', secret: true, help: 'Starts with sk_test_ or sk_live_.' },
      { key: 'stripe.webhookSecret', label: 'Webhook signing secret', secret: true, help: 'Starts with whsec_.' },
    ],
  },
  {
    key: 'BRAINTREE',
    name: 'Braintree',
    guide: '/help/braintree-setup',
    fields: [
      {
        key: 'braintree.environment',
        label: 'Environment',
        select: [
          { value: 'sandbox', label: 'Sandbox (test)' },
          { value: 'production', label: 'Production (live)' },
        ],
      },
      { key: 'braintree.merchantId', label: 'Merchant ID' },
      { key: 'braintree.publicKey', label: 'Public key' },
      { key: 'braintree.privateKey', label: 'Private key', secret: true },
    ],
  },
  {
    key: 'SQUARE',
    name: 'Square',
    guide: '/help/square-setup',
    fields: [
      {
        key: 'square.environment',
        label: 'Environment',
        select: [
          { value: 'sandbox', label: 'Sandbox (test)' },
          { value: 'production', label: 'Production (live)' },
        ],
      },
      { key: 'square.accessToken', label: 'Access token', secret: true },
      { key: 'square.locationId', label: 'Location ID' },
      { key: 'square.webhookSignatureKey', label: 'Webhook signature key', secret: true },
      {
        key: 'square.webhookUrl',
        label: 'Webhook notification URL (optional)',
        help: 'Leave blank to use your public address plus /api/payments/square/webhook.',
        optional: true,
      },
    ],
  },
];

function ProviderCard({ provider, values, secretsSet, canManage, onSaved }) {
  const [draft, setDraft] = useState({});
  const [clearing, setClearing] = useState({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState(null); // { severity, text }
  const [status, setStatus] = useState(null);

  useEffect(() => {
    setDraft({});
    setClearing({});
  }, [values]);

  const value = (field) => (draft[field.key] !== undefined ? draft[field.key] : values[field.key] ?? '');

  async function handleSave(e) {
    e.preventDefault();
    setMessage(null);
    setSaving(true);
    const payload = {};
    for (const field of provider.fields) {
      if (field.secret) {
        if (clearing[field.key]) payload[field.key] = '';
        else if (draft[field.key]) payload[field.key] = draft[field.key];
      } else if (draft[field.key] !== undefined) {
        payload[field.key] = draft[field.key];
      }
    }
    try {
      await api.put('/api/admin/integrations', payload);
      setMessage({ severity: 'success', text: `${provider.name} settings saved.` });
      onSaved();
    } catch (err) {
      setMessage({ severity: 'error', text: err.response?.data?.error ?? 'Could not save these settings.' });
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setStatus(null);
    try {
      const { data } = await api.post(`/api/admin/integrations/${provider.key}/test`);
      setStatus({ severity: 'success', text: data.message });
    } catch (err) {
      setStatus({ severity: 'error', text: err.response?.data?.error ?? 'The test failed.' });
    } finally {
      setTesting(false);
    }
  }

  // Configured once every required field has a value (optional fields can stay blank).
  const configured = provider.fields.every((f) =>
    f.optional ? true : f.secret ? Boolean(secretsSet[f.key]) : Boolean(values[f.key]),
  );

  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" fontWeight={600}>
          {provider.name}
        </Typography>
        <Chip size="small" label={configured ? 'Configured' : 'Not configured'} color={configured ? 'success' : 'default'} />
        <Button component={RouterLink} to={provider.guide} size="small" sx={{ ml: 'auto' }}>
          Setup guide
        </Button>
      </Stack>

      <form onSubmit={handleSave}>
        <Stack spacing={2}>
          {message && <Alert severity={message.severity}>{message.text}</Alert>}
          {provider.fields.map((field) => {
            if (field.select) {
              return (
                <TextField key={field.key} select label={field.label} value={value(field)} disabled={!canManage}
                  onChange={(e) => setDraft((d) => ({ ...d, [field.key]: e.target.value }))} fullWidth>
                  {field.select.map((o) => (
                    <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
                  ))}
                </TextField>
              );
            }
            if (field.secret) {
              const saved = Boolean(secretsSet[field.key]);
              const isClearing = Boolean(clearing[field.key]);
              return (
                <Stack key={field.key} direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
                  <TextField
                    label={field.label}
                    type="password"
                    autoComplete="new-password"
                    value={draft[field.key] ?? ''}
                    disabled={!canManage || isClearing}
                    placeholder={saved && !isClearing ? '•••••••• saved' : ''}
                    helperText={
                      isClearing
                        ? 'Will be removed when you save.'
                        : saved
                          ? 'Saved. Type a new value to replace it.'
                          : field.help ?? 'Not saved yet.'
                    }
                    onChange={(e) => setDraft((d) => ({ ...d, [field.key]: e.target.value }))}
                    fullWidth
                  />
                  {saved && canManage && (
                    <Button sx={{ mt: 1 }} color="error" onClick={() => setClearing((c) => ({ ...c, [field.key]: !c[field.key] }))}>
                      {isClearing ? 'Undo' : 'Clear'}
                    </Button>
                  )}
                </Stack>
              );
            }
            return (
              <TextField
                key={field.key}
                label={field.label}
                value={value(field)}
                disabled={!canManage}
                helperText={field.help}
                placeholder={field.optional ? '' : undefined}
                onChange={(e) => setDraft((d) => ({ ...d, [field.key]: e.target.value }))}
                fullWidth
              />
            );
          })}

          {status && <Alert severity={status.severity}>{status.text}</Alert>}

          {canManage && (
            <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
              <Button onClick={handleTest} disabled={testing || saving}>
                {testing ? 'Testing…' : 'Test connection'}
              </Button>
              <Button type="submit" variant="contained" disabled={saving}>
                {saving ? 'Saving…' : `Save ${provider.name}`}
              </Button>
            </Stack>
          )}
        </Stack>
      </form>
    </Paper>
  );
}

export function AdminIntegrationsPage() {
  const { can } = useAuth();
  const canManage = can('integrations.manage');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  async function load() {
    try {
      const { data: body } = await api.get('/api/admin/integrations');
      setData(body);
    } catch {
      setError('Could not load provider settings.');
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (!data) {
    return (
      <Container maxWidth="md" sx={{ py: 4 }}>
        {error && <Alert severity="error">{error}</Alert>}
      </Container>
    );
  }

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Typography variant="h5" fontWeight={600} gutterBottom>
        Payment providers
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Payment provider keys. Saved values take effect straight away, with no server restart needed. Keys are stored
        encrypted, and once saved they can't be viewed again, only replaced or cleared.
      </Typography>

      <Stack spacing={3}>
        {!data.encryptionReady && (
          <Alert severity="warning">
            Secret keys can't be saved yet. The server administrator needs to set <code>CONFIG_ENCRYPTION_KEY</code> in the
            project's <code>.env</code> file and restart the server. Other settings can still be saved.
          </Alert>
        )}
        {data.unreadable?.length > 0 && (
          <Alert severity="error">
            Some saved keys can't be decrypted, probably because <code>CONFIG_ENCRYPTION_KEY</code> changed. Re-enter
            them below.
          </Alert>
        )}
        {!canManage && <Alert severity="info">You can view these settings, but your role can't change them.</Alert>}

        {PROVIDERS.map((provider) => (
          <ProviderCard
            key={provider.key}
            provider={provider}
            values={data.values}
            secretsSet={data.secretsSet}
            canManage={canManage}
            onSaved={load}
          />
        ))}
      </Stack>
    </Container>
  );
}
