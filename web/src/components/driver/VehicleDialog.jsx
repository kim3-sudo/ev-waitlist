import { useState } from 'react';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField } from '@mui/material';
import { api } from '../../api/client.js';
import { CONNECTOR_STANDARD_OPTIONS } from '../../connectorOptions.js';
import { FeatureCheckboxes } from '../locator/FeatureCheckboxes.jsx';

const PLUG_OPTIONS = CONNECTOR_STANDARD_OPTIONS.map((o) => ({ key: o.value, label: o.name }));

// Adds a vehicle, or edits one. The plugs are what decide which charge points work for it.
export function VehicleDialog({ vehicle, onClose, onSaved }) {
  const [name, setName] = useState(vehicle?.name ?? '');
  const [make, setMake] = useState(vehicle?.make ?? '');
  const [model, setModel] = useState(vehicle?.model ?? '');
  const [licensePlate, setLicensePlate] = useState(vehicle?.licensePlate ?? '');
  const [plugs, setPlugs] = useState(vehicle?.plugs ?? []);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    const body = { name, make, model, licensePlate, plugs };
    try {
      const { data } = vehicle
        ? await api.put(`/api/driver/vehicles/${vehicle.id}`, body)
        : await api.post('/api/driver/vehicles', body);
      onSaved(data);
    } catch (err) {
      setError(err.response?.data?.error ?? 'The vehicle could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <form onSubmit={handleSubmit}>
        <DialogTitle>{vehicle ? 'Edit vehicle' : 'Add a vehicle'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField label="Name" helperText='For example "My IONIQ 5"' value={name} onChange={(e) => setName(e.target.value)} required fullWidth />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label="Make" value={make} onChange={(e) => setMake(e.target.value)} fullWidth />
              <TextField label="Model" value={model} onChange={(e) => setModel(e.target.value)} fullWidth />
            </Stack>
            <TextField label="License plate (optional)" value={licensePlate} onChange={(e) => setLicensePlate(e.target.value)} fullWidth />
            <FeatureCheckboxes
              legend="Plugs this vehicle can charge with"
              helperText="Tick every plug it can use, including with an adapter. Charge points with one of these plugs show as working with your vehicle."
              options={PLUG_OPTIONS}
              value={plugs}
              onChange={setPlugs}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={saving}>
            {saving ? 'Saving…' : 'Save vehicle'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
