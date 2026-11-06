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
  MenuItem,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import { api } from '../api/client.js';

// Used when the signed-in admin can't list roles (it needs users.manage).
const BUILT_IN_ROLE_NAMES = ['ADMIN', 'VIEWER'];

const NAME_ID_OPTIONS = [
  { value: 'emailAddress', label: 'Email address (the NameID is the user’s email)' },
  { value: 'persistent', label: 'Persistent (a stable opaque ID, such as a GUID)' },
  { value: 'unspecified', label: 'Unspecified (an opaque ID chosen by the IdP)' },
];

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
  const [roleNames, setRoleNames] = useState(BUILT_IN_ROLE_NAMES);
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
        nameIdFormat: config.nameIdFormat ?? 'emailAddress',
        groupAttribute: config.groupAttribute ?? '',
        groupRoleMappings: config.groupRoleMappings ?? [],
        // An empty default role means users in no mapped group are denied.
        defaultRole: config.defaultRole ?? '',
      });
      setSp(spDetails);
    });
    api
      .get('/api/admin/roles')
      .then(({ data }) => setRoleNames(data.roles.map((r) => r.name)))
      .catch(() => setRoleNames(BUILT_IN_ROLE_NAMES));
  }, []);

  function update(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  function updateSwitch(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.checked }));
  }

  function updateMapping(index, field, value) {
    setForm((f) => ({
      ...f,
      groupRoleMappings: f.groupRoleMappings.map((m, i) => (i === index ? { ...m, [field]: value } : m)),
    }));
  }

  function addMapping() {
    setForm((f) => ({
      ...f,
      groupRoleMappings: [...f.groupRoleMappings, { group: '', role: roleNames[0] ?? 'VIEWER' }],
    }));
  }

  function removeMapping(index) {
    setForm((f) => ({ ...f, groupRoleMappings: f.groupRoleMappings.filter((_, i) => i !== index) }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess(false);
    setSaving(true);
    try {
      await api.put('/api/admin/saml', {
        ...form,
        groupAttribute: form.groupAttribute.trim() || null,
        defaultRole: form.defaultRole || null,
        groupRoleMappings: form.groupRoleMappings.map((m) => ({ group: m.group.trim(), role: m.role })),
      });
      setSuccess(true);
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not save SSO settings.');
    } finally {
      setSaving(false);
    }
  }

  if (!form || !sp) return null;

  const groupRolesOn = form.groupAttribute.trim() !== '';

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

            <Typography variant="subtitle1" fontWeight={600}>
              Identifying users
            </Typography>
            <TextField
              select
              label="NameID format"
              value={form.nameIdFormat}
              onChange={update('nameIdFormat')}
              fullWidth
              helperText="Which NameID the identity provider sends. Opaque IDs are matched on the NameID, and the email comes from the email attribute."
            >
              {NAME_ID_OPTIONS.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>

            <Divider />

            <Typography variant="subtitle1" fontWeight={600}>
              Group-based roles
            </Typography>
            <TextField
              label="Group attribute name"
              value={form.groupAttribute}
              onChange={update('groupAttribute')}
              fullWidth
              placeholder="groups"
              helperText="The assertion attribute that lists a user's groups. Leave blank to turn off group-based roles."
            />

            {groupRolesOn && (
              <>
                <Stack spacing={1.5}>
                  <Typography variant="body2" fontWeight={600}>
                    Group to role mapping
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    The first group in this list that the user belongs to sets their role. Roles are reapplied at each
                    SSO login, so they override manual changes for SSO users.
                  </Typography>
                  {form.groupRoleMappings.length === 0 && (
                    <Typography variant="body2" color="text.secondary">
                      No mappings yet. Users get the default role below.
                    </Typography>
                  )}
                  {form.groupRoleMappings.map((mapping, index) => (
                    <Stack key={index} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <TextField
                        size="small"
                        label="Group"
                        value={mapping.group}
                        onChange={(e) => updateMapping(index, 'group', e.target.value)}
                        sx={{ flex: 1 }}
                      />
                      <TextField
                        size="small"
                        select
                        label="Role"
                        value={mapping.role}
                        onChange={(e) => updateMapping(index, 'role', e.target.value)}
                        sx={{ flex: 1 }}
                      >
                        {roleNames.map((name) => (
                          <MenuItem key={name} value={name}>
                            {name}
                          </MenuItem>
                        ))}
                      </TextField>
                      <IconButton onClick={() => removeMapping(index)} aria-label="Remove mapping">
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                  ))}
                  <Stack direction="row" sx={{ justifyContent: 'flex-start' }}>
                    <Button size="small" startIcon={<AddIcon />} onClick={addMapping}>
                      Add mapping
                    </Button>
                  </Stack>
                </Stack>

                <TextField
                  select
                  label="Default role for users in no mapped group"
                  value={form.defaultRole}
                  onChange={update('defaultRole')}
                  fullWidth
                  helperText="Choose Deny to block sign-in for users in none of the mapped groups."
                >
                  <MenuItem value="">Deny access</MenuItem>
                  {roleNames.map((name) => (
                    <MenuItem key={name} value={name}>
                      {name}
                    </MenuItem>
                  ))}
                </TextField>
              </>
            )}

            <Divider />

            <FormControlLabel
              control={<Switch checked={form.autoProvision} onChange={updateSwitch('autoProvision')} />}
              label="Auto-create an account for a new user on first SSO login"
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
