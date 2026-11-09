import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Box, Button, Divider, Paper, Stack, TextField, Typography } from '@mui/material';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { MfaEnrollForm } from '../components/MfaEnrollForm.jsx';
import { safeNextPath, sitePath } from '../sitePaths.js';

// The one sign-in for everyone. A password works for any account. A driver can also ask for a
// one-time code by e-mail, and a new e-mail address gets a driver account. Accounts with admin
// permissions are asked for a two-factor code after the password, when it is switched on.
const DRIVER_PERMISSION = 'driver.account';

// Admins go to the admin pages; driver-only accounts go to their account page, unless the
// sign-in was started from a page that asked to return somewhere.
function destinationAfterSignIn(permissions, nextParam) {
  const hasAdminAccess = permissions.some((p) => p !== DRIVER_PERMISSION);
  return safeNextPath(nextParam, hasAdminAccess ? '/admin' : sitePath('/driver'));
}

export function LoginPage() {
  const { login, completeMfa, setSession } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const nextParam = params.get('next');

  const [method, setMethod] = useState('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Password sign-in stage: null = credentials, otherwise { stage, preAuthToken }.
  const [pending, setPending] = useState(null);
  const [mfaCode, setMfaCode] = useState('');
  // Code sign-in stage: 'email' asks for the code, 'code' checks it.
  const [codeStage, setCodeStage] = useState('email');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [ssoEnabled, setSsoEnabled] = useState(false);

  useEffect(() => {
    api
      .get('/api/auth/saml/status')
      .then(({ data }) => setSsoEnabled(data.enabled))
      .catch(() => setSsoEnabled(false));
  }, []);

  // Runs one step, showing the server's message if it gave one.
  async function run(action, fallback) {
    setError('');
    setInfo('');
    setSubmitting(true);
    try {
      await action();
    } catch (err) {
      setError(err.response?.data?.error ?? fallback);
    } finally {
      setSubmitting(false);
    }
  }

  function finish(permissions) {
    navigate(destinationAfterSignIn(permissions ?? [], nextParam), { replace: true });
  }

  function switchMethod(next) {
    setMethod(next);
    setError('');
    setInfo('');
    setCodeStage('email');
  }

  const signInWithPassword = (e) => {
    e.preventDefault();
    run(async () => {
      const result = await login(email, password);
      if (result.done) return finish(result.permissions);
      setPending({ stage: result.stage, preAuthToken: result.preAuthToken });
    }, 'Invalid e-mail address or password.');
  };

  const submitMfaCode = (e) => {
    e.preventDefault();
    run(async () => {
      finish(await completeMfa(pending.preAuthToken, mfaCode));
    }, 'Invalid code.');
  };

  const requestCode = (e) => {
    e.preventDefault();
    run(async () => {
      await api.post('/api/auth/code/request', { email });
      setInfo(`We e-mailed a code to ${email}. It expires in 10 minutes.`);
      setCodeStage('code');
    }, 'Something went wrong. Please try again.');
  };

  const verifyCode = (e) => {
    e.preventDefault();
    run(async () => {
      try {
        const { data } = await api.post('/api/auth/code/verify', { email, code, name });
        setSession(data.token, data.email, false, data.role, data.permissions);
        finish(data.permissions);
      } catch (err) {
        // Admin accounts are not signed in by code. Send them to the password, with the reason.
        if (err.response?.data?.code === 'PASSWORD_SIGN_IN_REQUIRED') {
          switchMethod('password');
          setError(err.response.data.error);
          return;
        }
        throw err;
      }
    }, 'Something went wrong. Please try again.');
  };

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
          <MfaEnrollForm preAuthToken={pending.preAuthToken} onDone={(permissions) => finish(permissions)} />
        </Paper>
      </Box>
    );
  }

  if (pending?.stage === 'mfa') {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8, px: 2 }}>
        <Paper component="form" onSubmit={submitMfaCode} sx={{ p: 4, width: 360 }} elevation={2}>
          <Typography variant="h5" fontWeight={600} gutterBottom>
            Enter your authentication code
          </Typography>
          <Stack spacing={2} sx={{ mt: 2 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              label="6-digit code"
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value)}
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
      <Paper variant="outlined" sx={{ p: 4, width: 400, maxWidth: '100%' }} elevation={2}>
        <Typography variant="h5" fontWeight={600} gutterBottom>
          Sign in
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Sign in to keep your details and vehicles, so joining the waitlist is quicker.
        </Typography>

        <Stack spacing={2} sx={{ mt: 2 }}>
          {error && <Alert severity="error">{error}</Alert>}
          {info && <Alert severity="info">{info}</Alert>}

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
                <Button type="submit" variant="contained" size="large" disabled={submitting}>
                  {submitting ? 'Signing in…' : 'Sign in'}
                </Button>
                {ssoEnabled && (
                  <>
                    <Divider>or</Divider>
                    <Button href={`${api.defaults.baseURL}/api/auth/saml/login`} variant="outlined" size="large">
                      Sign in with SSO
                    </Button>
                  </>
                )}
              </Stack>
            </form>
          )}

          {method === 'code' && codeStage === 'email' && (
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
                <Button type="submit" variant="contained" size="large" disabled={submitting}>
                  {submitting ? 'Sending…' : 'Email me a sign-in code'}
                </Button>
              </Stack>
            </form>
          )}

          {method === 'code' && codeStage === 'code' && (
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
                <Button type="submit" variant="contained" size="large" disabled={submitting}>
                  {submitting ? 'Signing in…' : 'Sign in'}
                </Button>
                <Button
                  variant="text"
                  onClick={() => {
                    setCodeStage('email');
                    setError('');
                    setInfo('');
                  }}
                >
                  Send a new code
                </Button>
              </Stack>
            </form>
          )}

          <Button variant="text" onClick={() => switchMethod(method === 'password' ? 'code' : 'password')}>
            {method === 'password' ? 'Email me a sign-in code instead' : 'Use a password instead'}
          </Button>

          <Typography variant="body2" color="text.secondary">
            A new e-mail address that signs in with a code gets a driver account.
          </Typography>
        </Stack>
      </Paper>
    </Box>
  );
}
