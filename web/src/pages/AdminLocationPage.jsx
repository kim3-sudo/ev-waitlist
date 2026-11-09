import { useEffect, useState } from 'react';
import { Alert, Button, Container, FormControlLabel, Stack, Switch, TextField, Typography } from '@mui/material';
import { api } from '../api/client.js';
import { LocationPicker } from '../components/locator/LocationPicker.jsx';
import { FeatureCheckboxes } from '../components/locator/FeatureCheckboxes.jsx';
import { AMENITY_OPTIONS, PARKING_OPTIONS } from '../components/locator/locatorFormat.js';

const EMPTY = {
  address: '',
  city: '',
  postalCode: '',
  country: '',
  latitude: '',
  longitude: '',
  hours: '',
  amenities: '',
  amenityKeys: [],
  parkingKeys: [],
  accessControlled: false,
};

// The site's own address and pin, shown on the charger locator. Charge points that
// leave their own address blank use these details.
export function AdminLocationPage() {
  const [form, setForm] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api
      .get('/api/admin/locator/site')
      .then((res) => {
        const site = res.data;
        setForm({
          address: site.address ?? '',
          city: site.city ?? '',
          postalCode: site.postalCode ?? '',
          country: site.country ?? '',
          latitude: site.latitude ?? '',
          longitude: site.longitude ?? '',
          hours: site.hours ?? '',
          amenities: site.amenities ?? '',
          amenityKeys: site.amenityKeys ?? [],
          parkingKeys: site.parkingKeys ?? [],
          accessControlled: Boolean(site.accessControlled),
        });
      })
      .catch(() => setError('The site details could not be loaded.'))
      .finally(() => setLoading(false));
  }, []);

  const update = (field) => (e) => {
    setSaved(false);
    setForm((f) => ({ ...f, [field]: e.target.value }));
  };

  async function save(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const num = (v) => (v === '' || v == null ? null : Number(v));
      await api.put('/api/admin/locator/site', {
        ...form,
        latitude: num(form.latitude),
        longitude: num(form.longitude),
      });
      setSaved(true);
    } catch (err) {
      setError(err.response?.data?.error ?? 'The site details could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Typography sx={{ p: 3 }}>Loading…</Typography>;

  return (
    <Container maxWidth="md" sx={{ py: 3 }}>
      <form onSubmit={save}>
        <Stack spacing={2.5}>
          <div>
            <Typography variant="h5" sx={{ fontWeight: 600 }}>
              Site location
            </Typography>
            <Typography color="text.secondary" variant="body2">
              Where this site is on the charger locator's map. Charge points without their own address
              use these details.
            </Typography>
          </div>

          {error && <Alert severity="error">{error}</Alert>}
          {saved && <Alert severity="success">Saved.</Alert>}

          <LocationPicker
            latitude={form.latitude}
            longitude={form.longitude}
            onChange={({ latitude, longitude }) => {
              setSaved(false);
              setForm((f) => ({ ...f, latitude: String(latitude), longitude: String(longitude) }));
            }}
          />

          <TextField label="Street address" value={form.address} onChange={update('address')} fullWidth />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField label="City" value={form.city} onChange={update('city')} fullWidth />
            <TextField label="Postal code" value={form.postalCode} onChange={update('postalCode')} fullWidth />
            <TextField label="Country" value={form.country} onChange={update('country')} fullWidth />
          </Stack>
          <TextField label="Opening hours" helperText='For example "24/7" or "Mon–Sat 07:00–21:00"' value={form.hours} onChange={update('hours')} fullWidth />
          <TextField
            label="Nearby amenities"
            helperText="Comma-separated, e.g. Coffee, Restrooms, Shops"
            value={form.amenities}
            onChange={update('amenities')}
            fullWidth
          />

          <FeatureCheckboxes
            legend="Amenities nearby"
            options={AMENITY_OPTIONS}
            value={form.amenityKeys}
            onChange={(list) => {
              setSaved(false);
              setForm((f) => ({ ...f, amenityKeys: list }));
            }}
          />

          <FeatureCheckboxes
            legend="Parking at this site"
            helperText="Charge points at this site also show these."
            options={PARKING_OPTIONS}
            value={form.parkingKeys}
            onChange={(list) => {
              setSaved(false);
              setForm((f) => ({ ...f, parkingKeys: list }));
            }}
          />

          <FormControlLabel
            control={
              <Switch
                checked={form.accessControlled}
                onChange={(e) => {
                  setSaved(false);
                  setForm((f) => ({ ...f, accessControlled: e.target.checked }));
                }}
              />
            }
            label="Access-controlled site"
          />
          <Typography variant="body2" color="text.secondary" sx={{ mt: -2 }}>
            Turn this on for a site that drivers need permission to use, such as a workplace parking lot.
          </Typography>

          <div>
            <Button type="submit" variant="contained" disabled={saving}>
              {saving ? 'Saving…' : 'Save site location'}
            </Button>
          </div>
        </Stack>
      </form>
    </Container>
  );
}
