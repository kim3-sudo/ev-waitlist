import { useEffect, useState } from 'react';
import { Container, Typography, Paper, Stack, TextField, Button, Alert, Divider } from '@mui/material';
import { api } from '../api/client.js';
import { MfaEnrollForm } from '../components/MfaEnrollForm.jsx';

function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess(false);
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }
    setSubmitting(true);
    try {
      await api.put('/api/auth/password', { currentPassword, newPassword });
      setSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not change password.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Stack component="form" onSubmit={handleSubmit} spacing={2}>
      {error && <Alert severity="error">{error}</Alert>}
      {success && <Alert severity="success">Password changed.</Alert>}
      <TextField
        label="Current password"
        type="password"
        value={currentPassword}
        onChange={(e) => setCurrentPassword(e.target.value)}
        required
        fullWidth
      />
      <TextField
        label="New password"
        type="password"
        helperText="At least 8 characters"
        value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)}
        required
        fullWidth
      />
      <TextField
        label="Confirm new password"
        type="password"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
        required
        fullWidth
      />
      <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
        <Button type="submit" variant="contained" disabled={submitting}>
          {submitting ? 'Saving…' : 'Change password'}
        </Button>
      </Stack>
    </Stack>
  );
}

function TwoFactorSection({ me, onChanged }) {
  const [enrolling, setEnrolling] = useState(false);
  const [disabling, setDisabling] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleDisable(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await api.post('/api/auth/mfa/disable', { password });
      setDisabling(false);
      setPassword('');
      onChanged();
    } catch {
      setError('Invalid password.');
    } finally {
      setSubmitting(false);
    }
  }

  if (enrolling) {
    return (
      <MfaEnrollForm
        onDone={() => {
          setEnrolling(false);
          onChanged();
        }}
      />
    );
  }

  if (me.mfaEnabled) {
    return (
      <Stack spacing={2}>
        <Alert severity="success">Two-factor authentication is enabled on your account.</Alert>
        {!disabling ? (
          <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
            <Button color="error" onClick={() => setDisabling(true)}>
              Disable two-factor authentication
            </Button>
          </Stack>
        ) : (
          <Stack component="form" onSubmit={handleDisable} spacing={2}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              label="Confirm your password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              fullWidth
            />
            <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
              <Button onClick={() => setDisabling(false)}>Cancel</Button>
              <Button type="submit" color="error" variant="contained" disabled={submitting}>
                {submitting ? 'Disabling…' : 'Disable'}
              </Button>
            </Stack>
          </Stack>
        )}
      </Stack>
    );
  }

  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        Two-factor authentication is not set up on your account.
      </Typography>
      <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
        <Button variant="contained" onClick={() => setEnrolling(true)}>
          Enable two-factor authentication
        </Button>
      </Stack>
    </Stack>
  );
}

export function AccountPage() {
  const [me, setMe] = useState(null);

  async function refresh() {
    const { data } = await api.get('/api/auth/me');
    setMe(data);
  }

  useEffect(() => {
    refresh();
  }, []);

  if (!me) return null;

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Typography variant="h5" fontWeight={600} gutterBottom>
        My account
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {me.email}
      </Typography>

      <Paper variant="outlined" sx={{ p: 3, mb: 3 }}>
        <Typography variant="subtitle1" fontWeight={600} gutterBottom>
          Two-factor authentication
        </Typography>
        <Divider sx={{ mb: 2 }} />
        <TwoFactorSection me={me} onChanged={refresh} />
      </Paper>

      {me.hasPassword && (
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="subtitle1" fontWeight={600} gutterBottom>
            Change password
          </Typography>
          <Divider sx={{ mb: 2 }} />
          <ChangePasswordForm />
        </Paper>
      )}
    </Container>
  );
}
