import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Chip, Container, IconButton, Paper, Stack, TextField, Typography } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { VehicleDialog } from '../components/driver/VehicleDialog.jsx';
import { standardName } from '../components/locator/locatorFormat.js';
import { sitePath } from '../sitePaths.js';

// The driver's own account: their details, password, and vehicles with the plugs each can use.
export function DriverAccountPage() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [account, setAccount] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState(null); // null, 'new', or a vehicle
  const [message, setMessage] = useState(null);

  const load = useCallback(
    () =>
      api
        .get('/api/driver/me')
        .then(({ data }) => {
          setAccount(data);
          setLoadError('');
        })
        .catch(() => setLoadError('Your account could not be loaded.')),
    [],
  );

  useEffect(() => {
    load();
  }, [load]);

  if (loadError) return <Container sx={{ py: 4 }}><Alert severity="error">{loadError}</Alert></Container>;
  if (!account) return null;

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Stack spacing={3}>
        <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
          <div>
            <Typography variant="h5" fontWeight={600}>
              Your account
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {account.email}
            </Typography>
          </div>
          <Button
            variant="outlined"
            onClick={() => {
              logout();
              navigate(sitePath('/'));
            }}
          >
            Sign out
          </Button>
        </Stack>

        {message && (
          <Alert severity={message.type} onClose={() => setMessage(null)}>
            {message.text}
          </Alert>
        )}

        <Paper variant="outlined" sx={{ p: 3 }}>
          <DetailsForm account={account} onSaved={(text) => { setMessage({ type: 'success', text }); load(); }} onError={(text) => setMessage({ type: 'error', text })} />
        </Paper>

        <Paper variant="outlined" sx={{ p: 3 }}>
          <PasswordForm hasPassword={account.hasPassword} onSaved={() => setMessage({ type: 'success', text: 'Your password is saved.' })} onError={(text) => setMessage({ type: 'error', text })} />
        </Paper>

        <Paper variant="outlined" sx={{ p: 3 }}>
          <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
            <Typography variant="h6">Your vehicles</Typography>
            <Button variant="contained" onClick={() => setEditing('new')}>
              Add a vehicle
            </Button>
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Add each vehicle with the plugs it can charge with. The charger finder shows which charge points work with it.
          </Typography>
          {account.vehicles.length === 0 && <Typography color="text.secondary">No vehicles yet.</Typography>}
          <Stack spacing={2} divider={<div />}>
            {account.vehicles.map((vehicle) => (
              <Stack key={vehicle.id} direction="row" spacing={1} sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <Stack spacing={0.75} sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 600 }}>{vehicle.name}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {[vehicle.make, vehicle.model, vehicle.licensePlate].filter(Boolean).join(' · ') || 'No details'}
                  </Typography>
                  <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
                    {vehicle.plugs.map((plug) => (
                      <Chip key={plug} size="small" variant="outlined" label={standardName(plug)} />
                    ))}
                  </Stack>
                </Stack>
                <Stack direction="row" sx={{ flexShrink: 0 }}>
                  <IconButton aria-label={`Edit ${vehicle.name}`} onClick={() => setEditing(vehicle)}>
                    <EditIcon />
                  </IconButton>
                  <IconButton
                    aria-label={`Remove ${vehicle.name}`}
                    onClick={async () => {
                      if (!window.confirm(`Remove ${vehicle.name} from your account?`)) return;
                      try {
                        await api.delete(`/api/driver/vehicles/${vehicle.id}`);
                        setMessage({ type: 'success', text: `${vehicle.name} was removed.` });
                        load();
                      } catch (err) {
                        setMessage({ type: 'error', text: err.response?.data?.error ?? 'The vehicle could not be removed.' });
                      }
                    }}
                  >
                    <DeleteIcon />
                  </IconButton>
                </Stack>
              </Stack>
            ))}
          </Stack>
        </Paper>
      </Stack>

      {editing && (
        <VehicleDialog
          vehicle={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setMessage({ type: 'success', text: 'Your vehicle is saved.' });
            load();
          }}
        />
      )}
    </Container>
  );
}

function DetailsForm({ account, onSaved, onError }) {
  const [name, setName] = useState(account.name ?? '');
  const [phone, setPhone] = useState(account.phone ?? '');
  const [saving, setSaving] = useState(false);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.put('/api/driver/me', { name, phone });
      onSaved('Your details are saved.');
    } catch (err) {
      onError(err.response?.data?.error ?? 'Your details could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save}>
      <Stack spacing={2}>
        <Typography variant="h6">Your details</Typography>
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} fullWidth />
        <TextField
          label="Mobile number (optional)"
          helperText="Include the country code. Used to fill in the waitlist form; you still choose whether to get texts."
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          fullWidth
        />
        <Stack direction="row">
          <Button type="submit" variant="contained" disabled={saving}>
            Save details
          </Button>
        </Stack>
      </Stack>
    </form>
  );
}

function PasswordForm({ hasPassword, onSaved, onError }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.put('/api/driver/password', { currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      onSaved();
    } catch (err) {
      onError(err.response?.data?.error ?? 'Your password could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save}>
      <Stack spacing={2}>
        <Typography variant="h6">{hasPassword ? 'Change your password' : 'Set a password'}</Typography>
        <Typography variant="body2" color="text.secondary">
          {hasPassword
            ? 'Or sign in with a one-time code by e-mail, whichever you prefer.'
            : 'You can sign in with a one-time code by e-mail, or with a password once you set one.'}
        </Typography>
        {hasPassword && (
          <TextField
            label="Current password"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
            fullWidth
          />
        )}
        <TextField
          label="New password"
          type="password"
          autoComplete="new-password"
          helperText="At least 8 characters"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
          fullWidth
        />
        <Stack direction="row">
          <Button type="submit" variant="contained" disabled={saving}>
            {hasPassword ? 'Change password' : 'Set password'}
          </Button>
        </Stack>
      </Stack>
    </form>
  );
}
