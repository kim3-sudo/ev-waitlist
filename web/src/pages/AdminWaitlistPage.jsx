import { useEffect, useMemo, useState } from 'react';
import { Container, Paper, Typography, TextField, Button, Stack, Alert, MenuItem, FormLabel, RadioGroup, FormControlLabel, FormGroup, Checkbox, Radio, Box } from '@mui/material';
import { api } from '../api/client.js';
import { useSettings } from '../context/SettingsContext.jsx';
import { groupedRegions } from '../plateRegions.js';

const IDENTIFIER_OPTIONS = [
  { value: 'LICENSE_PLATE', label: 'License plate number only' },
  { value: 'PARKING_PERMIT', label: 'Parking permit number only' },
  { value: 'BOTH', label: 'Either license plate or parking permit' },
];

// "CODE, Name" per line -> [{ code, name }]. The server checks each entry.
function parseCustomLines(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [code, ...rest] = line.split(',');
      return { code: code.trim(), name: rest.join(',').trim() };
    });
}

function customToText(custom) {
  return (custom ?? []).map((c) => `${c.code}, ${c.name}`).join('\n');
}

// What the waitlist asks drivers for, and which license plate places it offers.
export function AdminWaitlistPage() {
  const { settings, loaded, refresh } = useSettings();
  const [form, setForm] = useState(null);
  const [customText, setCustomText] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (loaded && !form) {
      setForm({
        identifierMode: settings.identifierMode ?? 'LICENSE_PLATE',
        plateSets: settings.plateRegionConfig?.sets ?? [],
        defaultPlateRegion: settings.defaultPlateRegion ?? '',
      });
      setCustomText(customToText(settings.plateRegionConfig?.custom));
    }
  }, [loaded, settings, form]);

  const customRegions = useMemo(() => parseCustomLines(customText), [customText]);

  // The places the join form will offer, based on what is ticked and typed right now.
  const offeredRegions = useMemo(() => {
    if (!form) return [];
    const builtIn = (settings.plateRegionCatalog ?? []).filter((r) => form.plateSets.includes(r.set));
    const custom = customRegions
      .filter((r) => r.code && r.name)
      .map((r) => ({ code: r.code.toUpperCase(), name: r.name, group: 'Custom' }));
    return [...builtIn, ...custom];
  }, [form, settings.plateRegionCatalog, customRegions]);

  function update(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  function toggleSet(id) {
    return (e) =>
      setForm((f) => ({
        ...f,
        plateSets: e.target.checked ? [...f.plateSets, id] : f.plateSets.filter((s) => s !== id),
      }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess(false);
    setSaving(true);
    try {
      // A default place that is no longer offered is cleared, so the server does not reject the save.
      const offeredCodes = new Set(offeredRegions.map((r) => r.code));
      await api.put('/api/admin/settings', {
        identifierMode: form.identifierMode,
        plateRegionConfig: { sets: form.plateSets, custom: customRegions.map((r) => ({ code: r.code, name: r.name })) },
        defaultPlateRegion: offeredCodes.has(form.defaultPlateRegion) ? form.defaultPlateRegion : '',
      });
      await refresh();
      setSuccess(true);
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not save the waitlist settings.');
    } finally {
      setSaving(false);
    }
  }

  if (!form) return null;

  const regionOptions = groupedRegions(offeredRegions);

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Typography variant="h5" fontWeight={600} gutterBottom>
        Waitlist
      </Typography>

      <Paper variant="outlined" sx={{ p: 3, mt: 2 }}>
        <form onSubmit={handleSubmit}>
          <Stack spacing={3}>
            {error && <Alert severity="error">{error}</Alert>}
            {success && <Alert severity="success">Waitlist settings saved.</Alert>}

            <Box>
              <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                What drivers enter
              </Typography>
              <FormLabel>Which identifier should the waitlist join form require?</FormLabel>
              <RadioGroup value={form.identifierMode} onChange={update('identifierMode')}>
                {IDENTIFIER_OPTIONS.map((opt) => (
                  <FormControlLabel key={opt.value} value={opt.value} control={<Radio />} label={opt.label} />
                ))}
              </RadioGroup>
            </Box>

            <Stack spacing={2}>
              <Typography variant="subtitle1" fontWeight={600}>
                License plates
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Choose the places a driver&apos;s plate may be from. Drivers pick one when they join the waitlist. The
                first one you choose is selected by default.
              </Typography>
              <FormGroup>
                {(settings.plateRegionSets ?? []).map((set) => (
                  <FormControlLabel
                    key={set.id}
                    control={<Checkbox checked={form.plateSets.includes(set.id)} onChange={toggleSet(set.id)} />}
                    label={`${set.name} (${set.count})`}
                  />
                ))}
              </FormGroup>
              <TextField
                label="Other places"
                multiline
                minRows={3}
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                helperText="One per line, as code, name. For example: MX-CMX, Mexico City"
                fullWidth
              />
              <TextField
                select
                label="Default place"
                value={offeredRegions.some((r) => r.code === form.defaultPlateRegion) ? form.defaultPlateRegion : ''}
                onChange={update('defaultPlateRegion')}
                helperText={
                  offeredRegions.length === 0
                    ? 'Choose at least one place above.'
                    : 'Selected first on the join form. Drivers can change it.'
                }
                disabled={offeredRegions.length === 0}
                fullWidth
              >
                <MenuItem value="">No default</MenuItem>
                {regionOptions.flatMap((group) => [
                  <MenuItem key={`h-${group.name}`} disabled sx={{ opacity: '1 !important', fontWeight: 600 }}>
                    {group.name}
                  </MenuItem>,
                  ...group.items.map((r) => (
                    <MenuItem key={r.code} value={r.code} sx={{ pl: 4 }}>
                      {r.name}
                    </MenuItem>
                  )),
                ])}
              </TextField>
            </Stack>

            <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
              <Button type="submit" variant="contained" disabled={saving}>
                {saving ? 'Saving…' : 'Save waitlist settings'}
              </Button>
            </Stack>
          </Stack>
        </form>
      </Paper>
    </Container>
  );
}
