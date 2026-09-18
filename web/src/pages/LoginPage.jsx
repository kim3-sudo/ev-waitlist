import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Paper, TextField, Button, Typography, Alert, Stack, Divider } from '@mui/material';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { MfaEnrollForm } from '../components/MfaEnrollForm.jsx';

export function LoginPage() {
  const { login, completeMfa } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // null = credentials stage, otherwise { stage, preAuthToken }
  const [pending, setPending] = useState(null);
  const [code, setCode] = useState('');
  const [ssoEnabled, setSsoEnabled] = useState(false);

  useEffect(() => {
    api
      .get('/api/auth/saml/status')
      .then(({ data }) => setSsoEnabled(data.enabled))
      .catch(() => setSsoEnabled(false));
  }, []);

  async function handleCredentials(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const result = await login(email, password);
      if (result.done) {
        navigate('/admin');
      } else {
        setPending({ stage: result.stage, preAuthToken: result.preAuthToken });
      }
    } catch {
      setError('Invalid email or password.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleMfaCode(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await completeMfa(pending.preAuthToken, code);
      navigate('/admin');
    } catch {
      setError('Invalid code.');
    } finally {
      setSubmitting(false);
    }
  }

  if (pending?.stage === 'mfa-setup') {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8, px: 2 }}>
        <Paper sx={{ p: 4, width: 400 }} elevation={2}>
          <Typography variant="h5" fontWeight={600} gutterBottom>
            Set up two-factor authentication
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            This account is required to enable two-factor authentication before continuing.
          </Typography>
          <MfaEnrollForm
            preAuthToken={pending.preAuthToken}
            onDone={() => navigate('/admin')}
          />
        </Paper>
      </Box>
    );
  }

  if (pending?.stage === 'mfa') {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8, px: 2 }}>
        <Paper component="form" onSubmit={handleMfaCode} sx={{ p: 4, width: 360 }} elevation={2}>
          <Typography variant="h5" fontWeight={600} gutterBottom>
            Enter your authentication code
          </Typography>
          <Stack spacing={2} sx={{ mt: 2 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              label="6-digit code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              autoFocus
              required
              fullWidth
            />
            <Button type="submit" variant="contained" size="large" disabled={submitting}>
              {submitting ? 'Verifying…' : 'Verify'}
            </Button>
          </Stack>
        </Paper>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8, px: 2 }}>
      <Paper component="form" onSubmit={handleCredentials} sx={{ p: 4, width: 360 }} elevation={2}>
        <Typography variant="h5" fontWeight={600} gutterBottom>
          Administrator login
        </Typography>
        <Stack spacing={2} sx={{ mt: 2 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            fullWidth
          />
          <TextField
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            fullWidth
          />
          <Button type="submit" variant="contained" size="large" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </Button>
          {ssoEnabled && (
            <>
              <Divider>or</Divider>
              <Button
                href={`${api.defaults.baseURL}/api/auth/saml/login`}
                variant="outlined"
                size="large"
              >
                Sign in with SSO
              </Button>
            </>
          )}
        </Stack>
      </Paper>
    </Box>
  );
}
