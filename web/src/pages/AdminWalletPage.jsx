import { useEffect, useState } from 'react';
import { Alert, Button, Checkbox, Chip, Container, FormControlLabel, Paper, Stack, TextField, Typography } from '@mui/material';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { DESIGN_FIELDS, ICON_KEY, PassDesigner } from '../components/wallet/PassDesigner.jsx';

// Wallet passes: the Apple and Google Wallet settings a driver's pass needs. Secrets are never
// sent back. Once saved, the page only says so, and a new value replaces it.
const APPLE_FIELDS = [
  {
    key: 'wallet.apple.passTypeIdentifier',
    label: 'Pass type identifier',
    help: 'Made in your Apple developer account, for example pass.com.example.charging.',
  },
  { key: 'wallet.apple.teamIdentifier', label: 'Team identifier', help: 'The 10-character Team ID from your Apple developer account.' },
  { key: 'wallet.apple.organizationName', label: 'Organization name', help: 'Shown on the pass. Up to 60 characters.' },
  {
    key: 'wallet.apple.signingCertificate',
    label: 'Pass certificate (PEM)',
    multiline: true,
    help: 'The certificate for your pass type, converted to PEM. Starts with BEGIN CERTIFICATE.',
  },
  {
    key: 'wallet.apple.signingKey',
    label: 'Pass certificate private key (PEM)',
    secret: true,
    multiline: true,
    help: 'The private key that goes with the pass certificate, with no passphrase. Starts with BEGIN PRIVATE KEY.',
  },
  {
    key: 'wallet.apple.wwdrCertificate',
    label: 'Apple WWDR certificate (PEM)',
    multiline: true,
    help: "Apple's WWDR intermediate certificate, from apple.com/certificateauthority.",
  },
];

const GOOGLE_FIELDS = [
  { key: 'wallet.google.issuerId', label: 'Issuer ID', help: 'The number shown in the Google Pay & Wallet console.' },
  {
    key: 'wallet.google.classId',
    label: 'Class ID',
    help: 'The name of the generic pass class you made in the console, such as charging_pass.',
  },
  {
    key: 'wallet.google.serviceAccountKey',
    label: 'Service account key (JSON)',
    secret: true,
    multiline: true,
    help: 'The JSON key file of the service account that issues passes. Paste the whole file.',
  },
];

const ALL_FIELDS = [...APPLE_FIELDS, ...GOOGLE_FIELDS, ...DESIGN_FIELDS, { key: ICON_KEY }];

function statusChip(check) {
  if (!check.configured) return { label: 'Not set up', color: 'default' };
  if (check.ready) return { label: 'Ready', color: 'success' };
  return { label: 'Needs attention', color: 'warning' };
}

function problemsOf(check) {
  return [...check.missing.map((m) => `${m} is missing.`), ...check.invalid];
}

function WalletField({ field, value, secretSaved, removing, canManage, onChange, onRemove }) {
  if (field.secret) {
    return (
      <Stack spacing={0.5}>
        <TextField
          label={field.label}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={secretSaved && !removing ? 'Saved. Leave blank to keep it.' : undefined}
          helperText={removing ? 'The saved value will be removed when you save.' : field.help}
          type={field.multiline ? 'text' : 'password'}
          multiline={field.multiline}
          minRows={field.multiline ? 3 : undefined}
          autoComplete="off"
          slotProps={{ input: { sx: { fontFamily: field.multiline ? 'monospace' : undefined, fontSize: 13 } } }}
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
  return (
    <TextField
      label={field.label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      helperText={field.help}
      multiline={field.multiline}
      minRows={field.multiline ? 3 : undefined}
      slotProps={field.multiline ? { input: { sx: { fontFamily: 'monospace', fontSize: 13 } } } : undefined}
      disabled={!canManage}
      fullWidth
    />
  );
}

export function AdminWalletPage() {
  const { can } = useAuth();
  const canManage = can('wallet.manage');
  const [view, setView] = useState(null);
  const [draft, setDraft] = useState({});
  const [removing, setRemoving] = useState({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState(null);
  const [testResults, setTestResults] = useState(null);

  function apply(data) {
    setView(data);
    setDraft({});
    setRemoving({});
  }

  useEffect(() => {
    api
      .get('/api/admin/wallet')
      .then(({ data }) => apply(data))
      .catch(() => setMessage({ severity: 'error', text: 'Could not load the wallet settings.' }));
  }, []);

  if (!view) return null;

  const value = (key) => (draft[key] !== undefined ? draft[key] : (view.values[key] ?? ''));

  async function handleSave(e) {
    e.preventDefault();
    setMessage(null);
    setSaving(true);
    const payload = {};
    for (const field of ALL_FIELDS) {
      if (field.secret) {
        if (removing[field.key]) payload[field.key] = '';
        else if (draft[field.key]) payload[field.key] = draft[field.key];
      } else {
        payload[field.key] = value(field.key);
      }
    }
    try {
      const { data } = await api.put('/api/admin/wallet', payload);
      apply(data);
      setMessage({ severity: 'success', text: 'Wallet settings saved.' });
    } catch (err) {
      setMessage({ severity: 'error', text: err.response?.data?.error ?? 'Could not save the wallet settings.' });
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResults(null);
    try {
      const { data } = await api.post('/api/admin/wallet/test');
      setTestResults(data.results);
    } catch (err) {
      setTestResults([{ platform: '', ok: false, message: err.response?.data?.error ?? 'The test could not run.' }]);
    } finally {
      setTesting(false);
    }
  }

  const apple = view.status.apple;
  const google = view.status.google;

  function renderSection(title, fields, check, intro) {
    const chip = statusChip(check);
    const problems = problemsOf(check);
    return (
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center', mb: 1 }}>
          <Typography variant="subtitle1" fontWeight={600}>
            {title}
          </Typography>
          <Chip size="small" label={chip.label} color={chip.color} />
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {intro}
        </Typography>
        {check.configured && problems.length > 0 && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {problems.join(' ')}
          </Alert>
        )}
        <Stack spacing={2.5}>
          {fields.map((field) => (
            <WalletField
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
        </Stack>
      </Paper>
    );
  }

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Typography variant="h5" fontWeight={600} gutterBottom>
        Wallet passes
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Drivers add a pass to Apple Wallet or Google Wallet from their account. A charge point whose reader accepts
        passes can then start a charge when the driver taps the pass. See the help article on wallet passes for the
        steps.
      </Typography>
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

      <form onSubmit={handleSave}>
        <Stack spacing={3}>
          {renderSection(
            'Apple Wallet',
            APPLE_FIELDS,
            apple,
            'From your Apple developer account: a pass type ID, its certificate and key, and Apple\'s WWDR certificate.',
          )}
          {renderSection(
            'Google Wallet',
            GOOGLE_FIELDS,
            google,
            'From the Google Pay & Wallet console: the issuer ID and a generic pass class, and a service account that can issue passes.',
          )}
          <PassDesigner
            value={value}
            onChange={(key, v) => setDraft((d) => ({ ...d, [key]: v }))}
            organizationName={value('wallet.apple.organizationName')}
            canManage={canManage}
          />
          {canManage && (
            <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
              <Button type="submit" variant="contained" disabled={saving}>
                {saving ? 'Saving…' : 'Save wallet settings'}
              </Button>
            </Stack>
          )}
        </Stack>
      </form>

      <Paper variant="outlined" sx={{ p: 3, mt: 3 }}>
        <Typography variant="subtitle1" fontWeight={600} gutterBottom>
          Check the signing
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Builds a test pass for each platform that is filled in, using the saved settings. Save first.
        </Typography>
        <Button variant="outlined" onClick={handleTest} disabled={testing || (!apple.configured && !google.configured)}>
          {testing ? 'Checking…' : 'Check the signing'}
        </Button>
        {testResults && (
          <Stack spacing={1} sx={{ mt: 2 }}>
            {testResults.map((result) => (
              <Alert key={result.platform || result.message} severity={result.ok ? 'success' : 'error'}>
                {result.platform === 'apple' ? 'Apple Wallet: ' : result.platform === 'google' ? 'Google Wallet: ' : ''}
                {result.message}
              </Alert>
            ))}
          </Stack>
        )}
      </Paper>
    </Container>
  );
}
