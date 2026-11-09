import { useState } from 'react';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Button, Container, Link, Paper, Stack, TextField, Typography } from '@mui/material';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { safeNextPath, sitePath } from '../sitePaths.js';

// Driver sign-in: a one-time code e-mailed to the driver, or a password they chose. A new
// e-mail address gets a driver account. Admins sign in on the admin page, with two-factor.
export function DriverSignInPage() {
  const { setSession } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNextPath(params.get('next'), sitePath('/driver'));

  const [method, setMethod] = useState('code');
  const [stage, setStage] = useState('email');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  function finish(data) {
    setSession(data.token, data.email, false, data.role, data.permissions);
    navigate(next, { replace: true });
  }

  async function run(action) {
    setError('');
    setBusy(true);
    try {
      await action();
    } catch (err) {
      setError(err.response?.data?.error ?? 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const requestCode = (e) => {
    e.preventDefault();
    run(async () => {
      await api.post('/api/driver/code/request', { email });
      setInfo(`We e-mailed a code to ${email}. It expires in 10 minutes.`);
      setStage('code');
    });
  };

  const verifyCode = (e) => {
    e.preventDefault();
    run(async () => {
      const { data } = await api.post('/api/driver/code/verify', { email, code, name });
      finish(data);
    });
  };

  const signInWithPassword = (e) => {
    e.preventDefault();
    run(async () => {
      const { data } = await api.post('/api/driver/login', { email, password });
      finish(data);
    });
  };

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Typography variant="h5" fontWeight={600} gutterBottom>
          Sign in
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Sign in to keep your details and vehicles, so joining the waitlist is quicker.
        </Typography>

        <Stack spacing={2}>
          {error && <Alert severity="error">{error}</Alert>}
          {info && method === 'code' && stage === 'code' && <Alert severity="info">{info}</Alert>}

          {method === 'code' && stage === 'email' && (
            <form onSubmit={requestCode}>
              <Stack spacing={2}>
                <TextField
                  label="E-mail address"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  fullWidth
                />
                <Button type="submit" variant="contained" disabled={busy}>
                  {busy ? 'Sending…' : 'Email me a sign-in code'}
                </Button>
              </Stack>
            </form>
          )}

          {method === 'code' && stage === 'code' && (
            <form onSubmit={verifyCode}>
              <Stack spacing={2}>
                <TextField
                  label="Six-digit code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  slotProps={{ htmlInput: { inputMode: 'numeric', autoComplete: 'one-time-code', maxLength: 6 } }}
                  required
                  fullWidth
                />
                <TextField
                  label="Your name"
                  helperText="Only needed the first time, for a new account."
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  fullWidth
                />
                <Button type="submit" variant="contained" disabled={busy}>
                  {busy ? 'Signing in…' : 'Sign in'}
                </Button>
                <Button
                  variant="text"
                  onClick={() => {
                    setStage('email');
                    setError('');
                  }}
                >
                  Send a new code
                </Button>
              </Stack>
            </form>
          )}

          {method === 'password' && (
            <form onSubmit={signInWithPassword}>
              <Stack spacing={2}>
                <TextField
                  label="E-mail address"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  fullWidth
                />
                <TextField
                  label="Password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  fullWidth
                />
                <Button type="submit" variant="contained" disabled={busy}>
                  {busy ? 'Signing in…' : 'Sign in'}
                </Button>
              </Stack>
            </form>
          )}

          <Button
            variant="text"
            onClick={() => {
              setMethod(method === 'code' ? 'password' : 'code');
              setStage('email');
              setError('');
            }}
          >
            {method === 'code' ? 'Use a password instead' : 'Use a sign-in code instead'}
          </Button>

          <Typography variant="body2" color="text.secondary">
            Run this site? <Link component={RouterLink} to="/login">Sign in to the admin pages</Link>.
          </Typography>
        </Stack>
      </Paper>
    </Container>
  );
}
