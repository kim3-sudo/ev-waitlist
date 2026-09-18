import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import { useAuth } from '../context/AuthContext.jsx';

export function SsoCallbackPage() {
  const { setSession } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const token = searchParams.get('token');
    const email = searchParams.get('email');
    if (token && email) {
      setSession(token, email);
      navigate('/admin', { replace: true });
    } else {
      navigate('/login', { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}>
      <CircularProgress />
    </Box>
  );
}
