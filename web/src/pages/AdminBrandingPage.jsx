import { useEffect, useState } from 'react';
import { Autocomplete, Container, Paper, Typography, TextField, Button, Stack, Alert, Avatar } from '@mui/material';
import { api } from '../api/client.js';
import { useSettings } from '../context/SettingsContext.jsx';
import { COMMON_GOOGLE_FONTS, categoryFor, fontFamilyName, fontStackFor, loadFontPreviews } from '../theme.js';

const MAX_LOGO_BYTES = 500 * 1024;
const FONT_NAME_PATTERN = /^[A-Za-z0-9 ]{1,60}$/;
const DEFAULT_FONT_LABEL = 'Default (system font)';

// Company name, logo, colors and font. The waitlist settings are on their own page.
export function AdminBrandingPage() {
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
        fontFamily: fontFamilyName(settings.fontFamily) ?? '',
      });
    }
  }, [loaded, settings, form]);

  const fontName = form?.fontFamily ?? '';
  const fontProblem = fontName && !FONT_NAME_PATTERN.test(fontName) ? 'Use letters, digits and spaces only.' : null;

  // Load the common fonts so each name can show in its own face, plus the chosen one.
  useEffect(() => {
    loadFontPreviews([...COMMON_GOOGLE_FONTS.map((f) => f.family), ...(fontName && !fontProblem ? [fontName] : [])]);
  }, [fontName, fontProblem]);

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
    if (fontProblem) {
      setError(`Font: ${fontProblem}`);
      return;
    }
    setSaving(true);
    try {
      await api.put('/api/admin/settings', {
        companyName: form.companyName,
        logoUrl: form.logoUrl,
        primaryColor: form.primaryColor,
        secondaryColor: form.secondaryColor,
        // Sent as a CSS stack, as the rest of the app reads it.
        fontFamily: fontName ? fontStackFor(fontName, categoryFor(fontName)) : '',
      });
      await refresh();
      setSuccess(true);
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not save branding.');
    } finally {
      setSaving(false);
    }
  }

  if (!form) return null;

  const previewStack = fontName && !fontProblem ? fontStackFor(fontName, categoryFor(fontName)) : undefined;

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Typography variant="h5" fontWeight={600} gutterBottom>
        Branding
      </Typography>

      <Paper variant="outlined" sx={{ p: 3, mt: 2 }}>
        <form onSubmit={handleSubmit}>
          <Stack spacing={3}>
            {error && <Alert severity="error">{error}</Alert>}
            {success && <Alert severity="success">Branding saved.</Alert>}

            <TextField label="Company / product name" value={form.companyName} onChange={update('companyName')} required fullWidth />

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

            <Autocomplete
              freeSolo
              options={['', ...COMMON_GOOGLE_FONTS.map((f) => f.family)]}
              value={form.fontFamily}
              onChange={(_, value) => setForm((f) => ({ ...f, fontFamily: (value ?? '').trim() }))}
              onInputChange={(_, value, reason) => {
                if (reason === 'input') setForm((f) => ({ ...f, fontFamily: value.trim() }));
              }}
              getOptionLabel={(option) => option || DEFAULT_FONT_LABEL}
              renderOption={(props, option) => {
                const { key, ...rest } = props;
                return (
                  <li key={key} {...rest}>
                    <Typography sx={{ fontFamily: option ? fontStackFor(option, categoryFor(option)) : undefined, fontSize: 16 }}>
                      {option || DEFAULT_FONT_LABEL}
                    </Typography>
                  </li>
                );
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Font"
                  helperText={
                    fontProblem ??
                    'Search Google Fonts, or type the name of any Google Font. Choose the default to use the system font.'
                  }
                  error={Boolean(fontProblem)}
                />
              )}
            />

            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="caption" color="text.secondary">
                Preview
              </Typography>
              <Typography variant="h6" sx={{ fontFamily: previewStack }}>
                Garage P1 &ndash; Bay 3
              </Typography>
              <Typography variant="body2" sx={{ fontFamily: previewStack }}>
                Join the line, and we will let you know when a charger is free. 0123456789
              </Typography>
            </Paper>

            <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
              <Button type="submit" variant="contained" disabled={saving}>
                {saving ? 'Saving…' : 'Save branding'}
              </Button>
            </Stack>
          </Stack>
        </form>
      </Paper>
    </Container>
  );
}
