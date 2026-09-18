import { useEffect, useState } from 'react';
import {
  Container,
  Typography,
  Paper,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Chip,
  IconButton,
  Button,
  Stack,
  Switch,
  FormControlLabel,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Alert,
  Tooltip,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import LockResetIcon from '@mui/icons-material/LockReset';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useSettings } from '../context/SettingsContext.jsx';

function CreateUserDialog({ onClose, onSaved }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await api.post('/api/admin/users', { email, password: password || undefined });
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not create the user.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Add user</DialogTitle>
      <form onSubmit={handleSubmit}>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
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
              helperText="Leave blank for an SSO-only account (sign in via SAML instead)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

export function AdminUsersPage() {
  const { email: currentEmail } = useAuth();
  const { settings, refresh: refreshSettings } = useSettings();
  const [users, setUsers] = useState([]);
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [error, setError] = useState('');

  async function refresh() {
    const { data } = await api.get('/api/admin/users');
    setUsers(data);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleResetMfa(user) {
    await api.patch(`/api/admin/users/${user.id}`, { resetMfa: true });
    refresh();
  }

  async function handleDelete() {
    setError('');
    try {
      await api.delete(`/api/admin/users/${deleteTarget.id}`);
      setDeleteTarget(null);
      refresh();
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not delete the user.');
      setDeleteTarget(null);
    }
  }

  async function handleToggleMfaRequired(e) {
    await api.put('/api/admin/settings', { mfaRequired: e.target.checked });
    refreshSettings();
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5" fontWeight={600}>
          Users
        </Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreating(true)}>
          Add user
        </Button>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <FormControlLabel
          control={<Switch checked={Boolean(settings.mfaRequired)} onChange={handleToggleMfaRequired} />}
          label="Require two-factor authentication for all users"
        />
      </Paper>

      <Paper variant="outlined">
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Email</TableCell>
              <TableCell>Sign-in method</TableCell>
              <TableCell>Two-factor</TableCell>
              <TableCell>Created</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id} hover>
                <TableCell>{user.email}</TableCell>
                <TableCell>{user.hasPassword ? 'Password' : 'SSO only'}</TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    label={user.mfaEnabled ? 'Enabled' : 'Not set up'}
                    color={user.mfaEnabled ? 'success' : 'default'}
                  />
                </TableCell>
                <TableCell>{new Date(user.createdAt).toLocaleDateString()}</TableCell>
                <TableCell align="right">
                  {user.mfaEnabled && (
                    <Tooltip title="Reset two-factor authentication">
                      <IconButton size="small" onClick={() => handleResetMfa(user)} aria-label="Reset MFA">
                        <LockResetIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                  <IconButton
                    size="small"
                    color="error"
                    disabled={user.email === currentEmail}
                    onClick={() => setDeleteTarget(user)}
                    aria-label="Delete"
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      {creating && (
        <CreateUserDialog
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            refresh();
          }}
        />
      )}

      <Dialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)}>
        <DialogTitle>Delete user?</DialogTitle>
        <DialogContent>
          <Typography>“{deleteTarget?.email}” will lose access immediately. This can't be undone.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleDelete}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
