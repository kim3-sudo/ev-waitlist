import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  MenuItem,
  Button,
  Stack,
  Alert,
} from '@mui/material';
import { api } from '../api/client.js';

const emptyForm = { identity: '', name: '', vendor: '', model: '', location: '', connectorCount: 1, zoneId: '' };

export function StationFormDialog({ station, onClose, onSaved }) {
  const isEdit = Boolean(station);
  const [form, setForm] = useState(() =>
    isEdit
      ? {
          identity: station.identity,
          name: station.name,
          vendor: station.vendor ?? '',
          model: station.model ?? '',
          location: station.location ?? '',
          connectorCount: station.connectors.length || 1,
          zoneId: station.zoneId ?? '',
        }
      : emptyForm,
  );
  const [zones, setZones] = useState([]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.get('/api/admin/zones').then(({ data }) => setZones(data));
  }, []);

  function update(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const payload = { ...form, connectorCount: Number(form.connectorCount) };
      if (isEdit) {
        await api.put(`/api/admin/stations/${station.id}`, payload);
      } else {
        await api.post('/api/admin/stations', payload);
      }
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not save the station.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{isEdit ? 'Edit charge point' : 'Add charge point'}</DialogTitle>
      <form onSubmit={handleSubmit}>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              label="OCPP identity"
              helperText="Must match the ID the charge point connects with (ws://…/ocpp/<identity>)"
              value={form.identity}
              onChange={update('identity')}
              required
              fullWidth
            />
            <TextField label="Display name" value={form.name} onChange={update('name')} required fullWidth />
            <TextField label="Location" value={form.location} onChange={update('location')} fullWidth />
            <Stack direction="row" spacing={2}>
              <TextField label="Vendor" value={form.vendor} onChange={update('vendor')} fullWidth />
              <TextField label="Model" value={form.model} onChange={update('model')} fullWidth />
            </Stack>
            <TextField
              label="Connector count"
              type="number"
              slotProps={{ htmlInput: { min: 0 } }}
              value={form.connectorCount}
              onChange={update('connectorCount')}
              fullWidth
            />
            <TextField
              select
              label="Zone"
              helperText="Shares one waitlist with the rest of the zone -- leave blank for a standalone charger"
              value={form.zoneId}
              onChange={update('zoneId')}
              fullWidth
            >
              <MenuItem value="">No zone</MenuItem>
              {zones.map((zone) => (
                <MenuItem key={zone.id} value={zone.id}>
                  {zone.name}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={submitting}>
            {submitting ? 'Saving…' : 'Save'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
