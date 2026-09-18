import { useEffect, useState } from 'react';
import {
  Container,
  Typography,
  Paper,
  Stack,
  TextField,
  Button,
  Switch,
  FormControlLabel,
  Alert,
  Divider,
  IconButton,
  InputAdornment,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { api } from '../api/client.js';

function CopyField({ label, value }) {
  return (
    <TextField
      label={label}
      value={value}
      fullWidth
      size="small"
      slotProps={{
        input: {
          readOnly: true,
          endAdornment: (
            <InputAdornment position="end">
              <IconButton size="small" onClick={() => navigator.clipboard.writeText(value)} aria-label="Copy">
                <ContentCopyIcon fontSize="small" />
              </IconButton>
            </InputAdornment>
          ),
        },
      }}
    />
  );
}

export function AdminSsoPage() {
  const [form, setForm] = useState(null);
  const [sp, setSp] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/api/admin/saml').then(({ data }) => {
      const { sp: spDetails, ...config } = data;
      setForm({
        enabled: config.enabled,
        idpEntityId: config.idpEntityId ?? '',
        idpSsoUrl: config.idpSsoUrl ?? '',
        idpCertificate: config.idpCertificate ?? '',
        autoProvision: config.autoProvision,
      });
      setSp(spDetails);
    });
  }, []);

  function update(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  function updateSwitch(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.checked }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess(false);
    setSaving(true);
    try {
      await api.put('/api/admin/saml', form);
      setSuccess(true);
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not save SSO settings.');
    } finally {
      setSaving(false);
    }
  }

  if (!form || !sp) return null;

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Typography variant="h5" fontWeight={600} gutterBottom>
        Single sign-on (SAML)
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        This app acts as the SAML service provider. Give your identity provider the details below, then paste its
        details in to finish the connection.
      </Typography>

      <Paper variant="outlined" sx={{ p: 3, mb: 3 }}>
        <Typography variant="subtitle1" fontWeight={600} gutterBottom>
          Service provider details
        </Typography>
        <Stack spacing={2}>
          <CopyField label="Entity ID" value={sp.entityId} />
          <CopyField label="ACS (reply) URL" value={sp.acsUrl} />
          <CopyField label="Metadata URL" value={sp.metadataUrl} />
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 3 }}>
        <form onSubmit={handleSubmit}>
          <Stack spacing={3}>
            {error && <Alert severity="error">{error}</Alert>}
            {success && <Alert severity="success">SSO settings saved.</Alert>}

            <Typography variant="subtitle1" fontWeight={600}>
              Identity provider details
            </Typography>
            <TextField label="IdP entity ID" value={form.idpEntityId} onChange={update('idpEntityId')} fullWidth />
            <TextField
              label="IdP SSO URL"
              value={form.idpSsoUrl}
              onChange={update('idpSsoUrl')}
              fullWidth
              helperText="Where we redirect users to sign in"
            />
            <TextField
              label="IdP x.509 certificate"
              value={form.idpCertificate}
              onChange={update('idpCertificate')}
              fullWidth
              multiline
              minRows={4}
              helperText="PEM-encoded certificate used to verify signed assertions"
            />

            <Divider />

            <FormControlLabel
              control={<Switch checked={form.autoProvision} onChange={updateSwitch('autoProvision')} />}
              label="Auto-create an account for a new email on first SSO login"
            />
            <FormControlLabel
              control={<Switch checked={form.enabled} onChange={updateSwitch('enabled')} />}
              label="Enable SAML sign-in"
            />

            <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
              <Button type="submit" variant="contained" disabled={saving}>
                {saving ? 'Saving…' : 'Save SSO settings'}
              </Button>
            </Stack>
          </Stack>
        </form>
      </Paper>
    </Container>
  );
}
