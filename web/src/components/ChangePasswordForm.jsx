import { useState } from 'react';
import { Stack, TextField, Button, Alert } from '@mui/material';
import { api } from '../api/client.js';

export function ChangePasswordForm({ onSuccess }) {
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
      onSuccess?.();
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
