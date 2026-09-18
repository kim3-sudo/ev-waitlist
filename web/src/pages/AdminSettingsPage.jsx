import { useEffect, useState } from 'react';
import {
  Container,
  Paper,
  Typography,
  TextField,
  Button,
  Stack,
  Alert,
  Avatar,
  MenuItem,
  FormControl,
  InputLabel,
  Select,
  FormLabel,
  RadioGroup,
  FormControlLabel,
  Radio,
  Divider,
  Box,
} from '@mui/material';
import { api } from '../api/client.js';
import { useSettings } from '../context/SettingsContext.jsx';
import { FONT_OPTIONS } from '../theme.js';

const IDENTIFIER_OPTIONS = [
  { value: 'LICENSE_PLATE', label: 'License plate number only' },
  { value: 'PARKING_PERMIT', label: 'Parking permit number only' },
  { value: 'BOTH', label: 'Either license plate or parking permit' },
];

const MAX_LOGO_BYTES = 500 * 1024;

export function AdminSettingsPage() {
  const { settings, loaded, refresh } = useSettings();
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (loaded && !form) {
      setForm({
        companyName: settings.companyName ?? '',
        logoUrl: settings.logoUrl ?? '',
        primaryColor: settings.primaryColor ?? '#0d7a5f',
        secondaryColor: settings.secondaryColor ?? '#1565c0',
        fontFamily: settings.fontFamily ?? '',
        identifierMode: settings.identifierMode ?? 'LICENSE_PLATE',
      });
    }
  }, [loaded, settings, form]);

  function update(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  function handleLogoFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_LOGO_BYTES) {
      setError('Logo file is too large (max 500KB). Use a smaller image or link to a hosted URL instead.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setForm((f) => ({ ...f, logoUrl: reader.result }));
    reader.readAsDataURL(file);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess(false);
    setSaving(true);
    try {
      await api.put('/api/admin/settings', form);
      await refresh();
      setSuccess(true);
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  }

  if (!form) return null;

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Typography variant="h5" fontWeight={600} gutterBottom>
        Branding & waitlist settings
      </Typography>

      <Paper variant="outlined" sx={{ p: 3, mt: 2 }}>
        <form onSubmit={handleSubmit}>
          <Stack spacing={3}>
            {error && <Alert severity="error">{error}</Alert>}
            {success && <Alert severity="success">Settings saved.</Alert>}

            <Stack spacing={2}>
              <Typography variant="subtitle1" fontWeight={600}>
                Branding
              </Typography>
              <TextField
                label="Company / product name"
                value={form.companyName}
                onChange={update('companyName')}
                required
                fullWidth
              />

              <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                <Avatar src={form.logoUrl || undefined} variant="rounded" sx={{ width: 48, height: 48 }}>
                  {!form.logoUrl && form.companyName?.[0]}
                </Avatar>
                <Stack spacing={1} sx={{ flexGrow: 1 }}>
                  <TextField
                    label="Logo URL"
                    helperText="Paste a hosted image URL, or upload a file below."
                    value={form.logoUrl}
                    onChange={update('logoUrl')}
                    fullWidth
                  />
                  <Button component="label" size="small" variant="outlined">
                    Upload logo
                    <input type="file" accept="image/*" hidden onChange={handleLogoFile} />
                  </Button>
                </Stack>
              </Stack>

              <Stack direction="row" spacing={2}>
                <TextField
                  label="Primary color"
                  type="color"
                  value={form.primaryColor}
                  onChange={update('primaryColor')}
                  sx={{ width: 140 }}
                  slotProps={{ htmlInput: { style: { padding: 4, height: 40 } } }}
                />
                <TextField
                  label="Secondary color"
                  type="color"
                  value={form.secondaryColor}
                  onChange={update('secondaryColor')}
                  sx={{ width: 140 }}
                  slotProps={{ htmlInput: { style: { padding: 4, height: 40 } } }}
                />
              </Stack>

              <FormControl fullWidth>
                <InputLabel id="font-label">Font face</InputLabel>
                <Select
                  labelId="font-label"
                  label="Font face"
                  value={form.fontFamily}
                  onChange={update('fontFamily')}
                >
                  {FONT_OPTIONS.map((f) => (
                    <MenuItem key={f.label} value={f.value}>
                      {f.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Stack>

            <Divider />

            <Box>
              <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                Waitlist identifiers
              </Typography>
              <FormControl>
                <FormLabel>Which identifier should the waitlist join form require?</FormLabel>
                <RadioGroup value={form.identifierMode} onChange={update('identifierMode')}>
                  {IDENTIFIER_OPTIONS.map((opt) => (
                    <FormControlLabel key={opt.value} value={opt.value} control={<Radio />} label={opt.label} />
                  ))}
                </RadioGroup>
              </FormControl>
            </Box>

            <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
              <Button type="submit" variant="contained" disabled={saving}>
                {saving ? 'Saving…' : 'Save settings'}
              </Button>
            </Stack>
          </Stack>
        </form>
      </Paper>
    </Container>
  );
}
