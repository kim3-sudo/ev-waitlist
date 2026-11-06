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
  Typography,
} from '@mui/material';
import { api } from '../api/client.js';

// The connector standards offered in the form: a common subset of the values the server accepts.
const CONNECTOR_STANDARDS = [
  'IEC_62196_T2', 'IEC_62196_T2_COMBO', 'IEC_62196_T1', 'IEC_62196_T1_COMBO', 'IEC_62196_T3A', 'IEC_62196_T3C',
  'CHADEMO', 'TESLA_R', 'TESLA_S', 'DOMESTIC_F', 'DOMESTIC_E', 'DOMESTIC_G',
];
const POWER_TYPES = ['AC_1_PHASE', 'AC_2_PHASE', 'AC_2_PHASE_SPLIT', 'AC_3_PHASE', 'DC'];

const emptyForm = { identity: '', name: '', vendor: '', model: '', location: '', latitude: '', longitude: '', connectorCount: 1, zoneId: '' };

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
          latitude: station.latitude ?? '',
          longitude: station.longitude ?? '',
          connectorCount: station.connectors.length || 1,
          zoneId: station.zoneId ?? '',
        }
      : emptyForm,
  );
  const [zones, setZones] = useState([]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Connector details for roaming, keyed by connector number.
  const [details, setDetails] = useState(() => {
    const out = {};
    for (const c of station?.connectors ?? []) {
      out[c.connectorId] = {
        standard: c.standard ?? '',
        format: c.format ?? '',
        powerType: c.powerType ?? '',
        maxVoltage: c.maxVoltage ?? '',
        maxAmperage: c.maxAmperage ?? '',
      };
    }
    return out;
  });

  function updateDetail(connectorId, field, value) {
    setDetails((d) => ({ ...d, [connectorId]: { ...(d[connectorId] ?? {}), [field]: value } }));
  }

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
      // Coordinates are numbers, or empty to leave the station out of roaming.
      const toNumberOrNull = (v) => (v === '' || v == null ? null : Number(v));
      // One entry per connector shown below.
      const count = Number(form.connectorCount) || 0;
      const connectors = Array.from({ length: count }, (_, i) => i + 1).map((connectorId) => ({
        connectorId,
        ...(details[connectorId] ?? {}),
      }));
      const payload = {
        connectors,
        ...form,
        connectorCount: Number(form.connectorCount),
        latitude: toNumberOrNull(form.latitude),
        longitude: toNumberOrNull(form.longitude),
      };
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
              <TextField
                label="Latitude"
                helperText="Needed to show this station to roaming partners"
                value={form.latitude}
                onChange={update('latitude')}
                fullWidth
              />
              <TextField label="Longitude" value={form.longitude} onChange={update('longitude')} fullWidth />
            </Stack>
            <Stack direction="row" spacing={2}>
              {Number(form.connectorCount) > 0 && (
              <Stack spacing={1}>
                <Typography variant="subtitle2">Connector details (needed for roaming)</Typography>
                {Array.from({ length: Number(form.connectorCount) || 0 }, (_, i) => i + 1).map((id) => {
                  const d = details[id] ?? {};
                  return (
                    <Stack key={id} direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                      <Typography variant="body2" sx={{ alignSelf: 'center', minWidth: 80 }}>
                        Connector {id}
                      </Typography>
                      <TextField select size="small" label="Standard" value={d.standard ?? ''} onChange={(e) => updateDetail(id, 'standard', e.target.value)} sx={{ minWidth: 180 }}>
                        <MenuItem value="">Not set</MenuItem>
                        {CONNECTOR_STANDARDS.map((v) => <MenuItem key={v} value={v}>{v}</MenuItem>)}
                      </TextField>
                      <TextField select size="small" label="Format" value={d.format ?? ''} onChange={(e) => updateDetail(id, 'format', e.target.value)} sx={{ minWidth: 110 }}>
                        <MenuItem value="">Not set</MenuItem>
                        <MenuItem value="CABLE">CABLE</MenuItem>
                        <MenuItem value="SOCKET">SOCKET</MenuItem>
                      </TextField>
                      <TextField select size="small" label="Power" value={d.powerType ?? ''} onChange={(e) => updateDetail(id, 'powerType', e.target.value)} sx={{ minWidth: 140 }}>
                        <MenuItem value="">Not set</MenuItem>
                        {POWER_TYPES.map((v) => <MenuItem key={v} value={v}>{v}</MenuItem>)}
                      </TextField>
                      <TextField size="small" label="Volts" type="number" value={d.maxVoltage ?? ''} onChange={(e) => updateDetail(id, 'maxVoltage', e.target.value)} sx={{ width: 100 }} />
                      <TextField size="small" label="Amps" type="number" value={d.maxAmperage ?? ''} onChange={(e) => updateDetail(id, 'maxAmperage', e.target.value)} sx={{ width: 100 }} />
                    </Stack>
                  );
                })}
              </Stack>
              )}
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
