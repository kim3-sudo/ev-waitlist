import { useEffect, useState } from 'react';
import { Box, Button, Stack, TextField, Typography, Alert, CircularProgress } from '@mui/material';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

// Two-step TOTP enrollment: fetch a fresh secret + QR code, then confirm it
// with a code from the user's authenticator app.
//
// Pass `preAuthToken` when this runs as part of a forced first-login
// enrollment (no session token exists yet); omit it for self-service
// enrollment from the account page (uses the normal Bearer session).
export function MfaEnrollForm({ preAuthToken, onDone }) {
  const { completeMfaSetup } = useAuth();
  const [secret, setSecret] = useState(null);
  const [qrCode, setQrCode] = useState(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .post('/api/auth/mfa/setup/start', preAuthToken ? { preAuthToken } : {})
      .then(({ data }) => {
        if (cancelled) return;
        setSecret(data.secret);
        setQrCode(data.qrCode);
      })
      .catch(() => !cancelled && setError('Could not start MFA setup.'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [preAuthToken]);

  async function handleConfirm(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      if (preAuthToken) {
        await completeMfaSetup(preAuthToken, secret, code);
      } else {
        await api.post('/api/auth/mfa/setup/confirm', { secret, code });
      }
      onDone?.();
    } catch {
      setError('Invalid code. Check your authenticator app and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
        <CircularProgress size={28} />
      </Box>
    );
  }

  if (!secret) {
    return <Alert severity="error">{error || 'Could not start MFA setup.'}</Alert>;
  }

  return (
    <Stack component="form" onSubmit={handleConfirm} spacing={2}>
      {error && <Alert severity="error">{error}</Alert>}
      <Typography variant="body2" color="text.secondary">
        Scan this QR code with an authenticator app (Google Authenticator, 1Password, Authy, etc.), or enter the key
        manually.
      </Typography>
      <Box sx={{ display: 'flex', justifyContent: 'center' }}>
        <img src={qrCode} alt="MFA enrollment QR code" width={200} height={200} />
      </Box>
      <TextField label="Manual entry key" value={secret} slotProps={{ input: { readOnly: true } }} fullWidth />
      <TextField
        label="6-digit code from your app"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        inputMode="numeric"
        autoFocus
        required
        fullWidth
      />
      <Button type="submit" variant="contained" disabled={submitting}>
        {submitting ? 'Verifying…' : 'Confirm and enable'}
      </Button>
    </Stack>
  );
}
