import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Stack,
  Alert,
  Checkbox,
  FormControlLabel,
  ListSubheader,
  MenuItem,
  Paper,
  Typography,
} from '@mui/material';
import { api } from '../api/client.js';
import { useSettings } from '../context/SettingsContext.jsx';
import { groupedRegions } from '../plateRegions.js';

export function WaitlistJoinDialog({ target, onClose, onJoined }) {
  const { settings } = useSettings();
  const identifierMode = settings.identifierMode ?? 'LICENSE_PLATE';
  const showPlate = identifierMode === 'LICENSE_PLATE' || identifierMode === 'BOTH';
  const showPermit = identifierMode === 'PARKING_PERMIT' || identifierMode === 'BOTH';

  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [licensePlate, setLicensePlate] = useState('');
  const [plateRegion, setPlateRegion] = useState(settings.defaultPlateRegion ?? '');
  const [parkingPermit, setParkingPermit] = useState('');
  // Text messages, when the site has them set up. The driver opts in and gives a mobile number.
  const smsOffered = Boolean(settings.smsAvailable);
  const [wantsSms, setWantsSms] = useState(false);
  const [smsNumber, setSmsNumber] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Roaming: when the site has it on, the warning must be read and accepted.
  const [roaming, setRoaming] = useState(null);
  const [warningAccepted, setWarningAccepted] = useState(false);

  useEffect(() => {
    api
      .get('/api/settings/roaming')
      .then(({ data }) => setRoaming(data))
      .catch(() => setRoaming({ enabled: false }));
  }, []);

  const roamingOn = Boolean(roaming?.enabled);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (identifierMode === 'BOTH' && !licensePlate.trim() && !parkingPermit.trim()) {
      setError('Enter a license plate number or a parking permit number.');
      return;
    }
    if (showPlate && licensePlate.trim() && !plateRegion) {
      setError('Choose the place where the plate was issued.');
      return;
    }

    setSubmitting(true);
    try {
      const path = target.kind === 'zone' ? `/api/zones/${target.id}/waitlist` : `/api/stations/${target.id}/waitlist`;
      const { data } = await api.post(path, {
        name,
        contact,
        licensePlate: showPlate ? licensePlate : undefined,
        plateRegion: showPlate ? plateRegion : undefined,
        parkingPermit: showPermit ? parkingPermit : undefined,
        smsNumber: smsOffered && wantsSms ? smsNumber : undefined,
        roamingWarningAccepted: roamingOn ? warningAccepted : undefined,
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
            {/* Without text messages, the contact is an e-mail address only. */}
            <TextField
              label={smsOffered ? 'Email or phone' : 'Email'}
              type={smsOffered ? 'text' : 'email'}
              helperText={
                smsOffered
                  ? "We'll notify you here when a charger is ready."
                  : "We'll e-mail you here when a charger is ready."
              }
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              required
              fullWidth
            />
            {smsOffered && (
              <Stack spacing={1}>
                <FormControlLabel
                  control={<Checkbox checked={wantsSms} onChange={(e) => setWantsSms(e.target.checked)} />}
                  label="Also send me text messages"
                />
                {wantsSms && (
                  <TextField
                    label="Mobile number"
                    type="tel"
                    value={smsNumber}
                    onChange={(e) => setSmsNumber(e.target.value)}
                    helperText="Include the country code, for example +1 555 123 4567."
                    required
                    fullWidth
                  />
                )}
              </Stack>
            )}
            {showPlate && (
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  select
                  label="Plate issued in"
                  value={plateRegion}
                  onChange={(e) => setPlateRegion(e.target.value)}
                  sx={{ minWidth: { sm: 180 } }}
                  required={identifierMode === 'LICENSE_PLATE'}
                >
                  {groupedRegions(settings.plateRegions).map((group) => [
                    <ListSubheader key={`h-${group.name}`}>{group.name}</ListSubheader>,
                    ...group.items.map((r) => (
                      <MenuItem key={r.code} value={r.code}>
                        {r.name}
                      </MenuItem>
                    )),
                  ])}
                </TextField>
                <TextField
                  label="License plate number"
                  value={licensePlate}
                  onChange={(e) => setLicensePlate(e.target.value)}
                  required={identifierMode === 'LICENSE_PLATE'}
                  fullWidth
                />
              </Stack>
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
            {roamingOn && (
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Stack spacing={1}>
                  <Typography variant="subtitle2">Please read before joining</Typography>
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-line' }}>
                    {roaming.warningText}
                  </Typography>
                  <FormControlLabel
                    control={
                      <Checkbox checked={warningAccepted} onChange={(e) => setWarningAccepted(e.target.checked)} required />
                    }
                    label="I have read and accept this warning"
                  />
                </Stack>
              </Paper>
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={submitting || (roamingOn && !warningAccepted)}>
            {submitting ? 'Joining…' : 'Join waitlist'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
