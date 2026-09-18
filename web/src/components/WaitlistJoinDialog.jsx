import { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Stack,
  Alert,
} from '@mui/material';
import { api } from '../api/client.js';
import { useSettings } from '../context/SettingsContext.jsx';

export function WaitlistJoinDialog({ target, onClose, onJoined }) {
  const { settings } = useSettings();
  const identifierMode = settings.identifierMode ?? 'LICENSE_PLATE';
  const showPlate = identifierMode === 'LICENSE_PLATE' || identifierMode === 'BOTH';
  const showPermit = identifierMode === 'PARKING_PERMIT' || identifierMode === 'BOTH';

  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [licensePlate, setLicensePlate] = useState('');
  const [parkingPermit, setParkingPermit] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (identifierMode === 'BOTH' && !licensePlate.trim() && !parkingPermit.trim()) {
      setError('Enter a license plate number or a parking permit number.');
      return;
    }

    setSubmitting(true);
    try {
      const path = target.kind === 'zone' ? `/api/zones/${target.id}/waitlist` : `/api/stations/${target.id}/waitlist`;
      const { data } = await api.post(path, {
        name,
        contact,
        licensePlate: showPlate ? licensePlate : undefined,
        parkingPermit: showPermit ? parkingPermit : undefined,
      });
      onJoined({ entryId: data.id });
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not join the waitlist. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Join waitlist &mdash; {target.name}</DialogTitle>
      <form onSubmit={handleSubmit}>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              label="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
              fullWidth
            />
            <TextField
              label="Email or phone"
              helperText="We'll notify you here when a charger is ready."
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              required
              fullWidth
            />
            {showPlate && (
              <TextField
                label="License plate number"
                value={licensePlate}
                onChange={(e) => setLicensePlate(e.target.value)}
                required={identifierMode === 'LICENSE_PLATE'}
                fullWidth
              />
            )}
            {showPermit && (
              <TextField
                label="Parking permit number"
                value={parkingPermit}
                onChange={(e) => setParkingPermit(e.target.value)}
                required={identifierMode === 'PARKING_PERMIT'}
                fullWidth
              />
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={submitting}>
            {submitting ? 'Joining…' : 'Join waitlist'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
