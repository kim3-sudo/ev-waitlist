import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

// SAML sign-in ends here with a one-time code in the address (never a session token). The code is
// traded for a session once, and the address is replaced so the code does not stay in the history.
export function SsoCallbackPage() {
  const { setSession } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const code = searchParams.get('code');
    if (!code) {
      navigate('/login', { replace: true });
      return;
    }
    window.history.replaceState(null, '', window.location.pathname);
    api
      .post('/api/auth/saml/exchange', { code })
      .then(({ data }) => {
        setSession(data.token, data.email, data.mustChangePassword, data.role, data.permissions);
        navigate('/admin', { replace: true });
      })
      .catch(() => navigate('/login', { replace: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}>
      <CircularProgress />
    </Box>
  );
}
