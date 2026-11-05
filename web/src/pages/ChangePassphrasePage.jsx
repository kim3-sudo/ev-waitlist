import { useNavigate } from 'react-router-dom';
import { Container, Paper, Typography, Alert } from '@mui/material';
import { ChangePasswordForm } from '../components/ChangePasswordForm.jsx';
import { useAuth } from '../context/AuthContext.jsx';

// Shown once, right after the first-run admin signs in. Nothing else in the
// admin area is reachable until the generated passphrase is replaced.
export function ChangePassphrasePage() {
  const { clearPasswordChange } = useAuth();
  const navigate = useNavigate();

  function handleChanged() {
    clearPasswordChange();
    navigate('/admin', { replace: true });
  }

  return (
    <Container maxWidth="sm" sx={{ py: 6 }}>
      <Typography variant="h5" fontWeight={600} gutterBottom>
        Choose a new passphrase
      </Typography>
      <Alert severity="info" sx={{ mb: 2 }}>
        This account was created with a generated passphrase. Enter it as your current password, then choose
        your own before continuing.
      </Alert>
      <Paper variant="outlined" sx={{ p: 3 }}>
        <ChangePasswordForm onSuccess={handleChanged} />
      </Paper>
    </Container>
  );
}
