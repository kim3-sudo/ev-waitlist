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
  Divider,
  Checkbox,
  FormControlLabel,
} from '@mui/material';
import { api } from '../api/client.js';
import { ConnectorFields } from './ConnectorFields.jsx';
import { LocationPicker } from './locator/LocationPicker.jsx';
import { FeatureCheckboxes } from './locator/FeatureCheckboxes.jsx';
import { PARKING_OPTIONS } from './locator/locatorFormat.js';
import { ConnectionTest } from './ConnectionTest.jsx';

const emptyForm = {
  identity: '',
  name: '',
  vendor: '',
  model: '',
  location: '',
  latitude: '',
  longitude: '',
  city: '',
  postalCode: '',
  country: '',
  hours: '',
  amenities: '',
  tips: '',
  parkingKeys: [],
  connectorCount: 1,
  zoneId: '',
  walletTap: false,
  smartChargingEnabled: false,
  firmwareUpdateEnabled: false,
  localListEnabled: false,
};

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
          city: station.city ?? '',
          postalCode: station.postalCode ?? '',
          country: station.country ?? '',
          hours: station.hours ?? '',
          amenities: station.amenities ?? '',
          tips: station.tips ?? '',
          parkingKeys: station.parkingKeys ?? [],
          connectorCount: station.connectors.length || 1,
          zoneId: station.zoneId ?? '',
          walletTap: Boolean(station.walletTap),
          smartChargingEnabled: Boolean(station.smartChargingEnabled),
          firmwareUpdateEnabled: Boolean(station.firmwareUpdateEnabled),
          localListEnabled: Boolean(station.localListEnabled),
        }
      : emptyForm,
  );
  const [zones, setZones] = useState([]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Connector details, keyed by connector number. Needed for roaming, and shown to drivers.
  const [details, setDetails] = useState(() => {
    const out = {};
    for (const c of station?.connectors ?? []) {
      out[c.connectorId] = {
        standard: c.standard ?? '',
        format: c.format ?? '',
        powerType: c.powerType ?? '',
        maxVoltage: c.maxVoltage ?? '',
        maxAmperage: c.maxAmperage ?? '',
        phaseCount: c.phaseCount ?? '',
        phase: c.phase ?? '',
      };
    }
    return out;
  });

  function updateDetail(connectorId, field, value) {
    setDetails((d) => ({ ...d, [connectorId]: { ...(d[connectorId] ?? {}), [field]: value } }));
  }

  useEffect(() => {
    api.get('/api/admin/zones', { params: { limit: 200 } }).then(({ data }) => setZones(data.data));
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
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>{isEdit ? 'Edit charge point' : 'Add charge point'}</DialogTitle>
      <form onSubmit={handleSubmit}>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label="OCPP identity"
                helperText="Must match the ID the charge point connects with (ws://…/ocpp/<identity>)"
                value={form.identity}
                onChange={update('identity')}
                required
                fullWidth
              />
              <TextField label="Display name" value={form.name} onChange={update('name')} required fullWidth />
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label="Vendor" value={form.vendor} onChange={update('vendor')} fullWidth />
              <TextField label="Model" value={form.model} onChange={update('model')} fullWidth />
            </Stack>
            <TextField label="Location" value={form.location} onChange={update('location')} fullWidth />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label="Latitude"
                helperText="Needed to show this station to roaming partners"
                value={form.latitude}
                onChange={update('latitude')}
                fullWidth
              />
              <TextField label="Longitude" value={form.longitude} onChange={update('longitude')} fullWidth />
            </Stack>
            <LocationPicker
              latitude={form.latitude}
              longitude={form.longitude}
              onChange={({ latitude, longitude }) =>
                setForm((f) => ({ ...f, latitude: String(latitude), longitude: String(longitude) }))
              }
              onPick={(result) =>
                setForm((f) => {
                  const a = result.address;
                  const street = [a.house_number, a.road].filter(Boolean).join(' ');
                  return {
                    ...f,
                    location: f.location || street,
                    city: f.city || a.city || a.town || a.village || '',
                    postalCode: f.postalCode || a.postcode || '',
                    country: f.country || a.country || '',
                  };
                })
              }
            />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label="City" value={form.city} onChange={update('city')} fullWidth />
              <TextField label="Postal code" value={form.postalCode} onChange={update('postalCode')} fullWidth />
              <TextField label="Country" value={form.country} onChange={update('country')} fullWidth />
            </Stack>
            <TextField
              label="Opening hours"
              helperText="Leave blank to use the site's hours"
              value={form.hours}
              onChange={update('hours')}
              fullWidth
            />
            <TextField
              label="Nearby amenities"
              helperText="Comma-separated, e.g. Coffee, Restrooms, Shops"
              value={form.amenities}
              onChange={update('amenities')}
              fullWidth
            />
            <TextField
              label="Tips for drivers"
              helperText="Optional. Shown in the Help tab when a driver joins or starts charging here, e.g. where to find the charger. Up to 500 characters."
              value={form.tips}
              onChange={update('tips')}
              multiline
              minRows={2}
              fullWidth
            />
            <FeatureCheckboxes
              legend="Parking at this charge point"
              helperText="A site's parking also applies to its charge points."
              options={PARKING_OPTIONS}
              value={form.parkingKeys}
              onChange={(list) => setForm((f) => ({ ...f, parkingKeys: list }))}
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
            <FormControlLabel
              control={
                <Checkbox
                  checked={form.walletTap}
                  onChange={(e) => setForm((f) => ({ ...f, walletTap: e.target.checked }))}
                />
              }
              label="Accepts wallet passes (tap to start)"
            />
            <Typography variant="body2" color="text.secondary" sx={{ mt: -2 }}>
              Turn this on only if the charge point's NFC reader can read Apple or Google Wallet passes. Your reader vendor can confirm this.
            </Typography>

            <Divider />

            <Typography variant="subtitle1" fontWeight={600}>
              Features this charge point supports
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: -2 }}>
              Turn on only what the charge point's hardware and firmware actually support. The server sends a feature's messages only when it is on.
            </Typography>
            <FormControlLabel
              control={
                <Checkbox
                  checked={form.smartChargingEnabled}
                  onChange={(e) => setForm((f) => ({ ...f, smartChargingEnabled: e.target.checked }))}
                />
              }
              label="Smart charging (power limits set by the server)"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={form.firmwareUpdateEnabled}
                  onChange={(e) => setForm((f) => ({ ...f, firmwareUpdateEnabled: e.target.checked }))}
                />
              }
              label="Firmware updates and diagnostics logs"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={form.localListEnabled}
                  onChange={(e) => setForm((f) => ({ ...f, localListEnabled: e.target.checked }))}
                />
              }
              label="Local authorization list (works while offline)"
            />

            <Divider />

            <Typography variant="subtitle1" fontWeight={600}>
              Connectors
            </Typography>
            <TextField
              label="Connector count"
              type="number"
              slotProps={{ htmlInput: { min: 0 } }}
              value={form.connectorCount}
              onChange={update('connectorCount')}
              sx={{ maxWidth: 220 }}
            />
            <ConnectorFields
              count={form.connectorCount}
              details={details}
              onChange={updateDetail}
              intro="Fill in each connector's details. Drivers see them on the waitlist, and roaming partners need them to find your charger."
            />

            <Divider />

            <Typography variant="subtitle1" fontWeight={600}>
              Connection
            </Typography>
            <ConnectionTest
              identity={isEdit ? station.identity : ''}
              disabled={!isEdit}
              disabledReason="Save the charge point first. Then open it again to test the connection."
            />
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
