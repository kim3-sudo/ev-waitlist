import { useState } from 'react';
import { Alert, Box, Button, Paper, Stack, TextField, Typography } from '@mui/material';

// The look of a driver's pass. The saved values are sent with the rest of the wallet settings.
// An empty value uses the built-in default, which is shown in each field's help.
export const DESIGN_FIELDS = [
  { key: 'wallet.design.backgroundColor', label: 'Background colour', colour: true, fallback: '#166534' },
  { key: 'wallet.design.foregroundColor', label: 'Text colour', colour: true, fallback: '#FFFFFF' },
  { key: 'wallet.design.labelColor', label: 'Label colour', colour: true, fallback: '#D1FAE5' },
  {
    key: 'wallet.design.primaryLabel',
    label: 'Front label',
    help: 'The small heading on the front, up to 30 characters. Default: CHARGING PASS.',
  },
  {
    key: 'wallet.design.primaryValue',
    label: 'Front text',
    help: 'The large line on the front, up to 40 characters. Default: Tap to charge.',
  },
  {
    key: 'wallet.design.backText',
    label: 'Back text',
    multiline: true,
    help: 'Shown on the back of the pass, up to 500 characters. Leave blank for the standard text.',
  },
];

export const ICON_KEY = 'wallet.design.iconPng';
const ICON_SIZE = 58;
const ICON_MAX_BYTES = 45000; // about 60000 characters once base64 encoded

// Reads a PNG's pixel size from its header. Returns null when the bytes are not a PNG.
function pngSize(bytes) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 24 || signature.some((b, i) => bytes[i] !== b)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function toBase64(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

// The designer: the colour and text fields, the icon, and a preview that updates as you type.
// `value(key)` returns the current value, and `onChange(key, value)` changes it.
export function PassDesigner({ value, onChange, organizationName, canManage }) {
  const [iconError, setIconError] = useState('');
  const icon = value(ICON_KEY);

  async function handleIcon(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setIconError('');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const size = pngSize(bytes);
    if (!size) return setIconError('The icon must be a PNG image.');
    if (size.width !== ICON_SIZE || size.height !== ICON_SIZE) {
      return setIconError(`The icon must be ${ICON_SIZE} by ${ICON_SIZE} pixels. This one is ${size.width} by ${size.height}.`);
    }
    if (bytes.length > ICON_MAX_BYTES) return setIconError('The icon file is too large. Use a plain PNG.');
    onChange(ICON_KEY, toBase64(bytes));
  }

  const preview = {
    background: value('wallet.design.backgroundColor') || DESIGN_FIELDS[0].fallback,
    color: value('wallet.design.foregroundColor') || DESIGN_FIELDS[1].fallback,
    label: value('wallet.design.labelColor') || DESIGN_FIELDS[2].fallback,
  };

  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Typography variant="subtitle1" fontWeight={600} gutterBottom>
        Pass design
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Choose how the pass looks in Apple Wallet and Google Wallet. Changes apply to passes made after you save. Passes
        already on drivers' phones keep their old look.
      </Typography>

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} sx={{ alignItems: 'flex-start' }}>
        <Stack spacing={2.5} sx={{ flex: 1, minWidth: 0, width: '100%' }}>
          {DESIGN_FIELDS.map((field) => {
            const current = value(field.key);
            if (field.colour) {
              return (
                <TextField
                  key={field.key}
                  type="color"
                  label={field.label}
                  value={(current || field.fallback).toLowerCase()}
                  onChange={(e) => onChange(field.key, e.target.value)}
                  helperText={`${current || field.fallback} (default ${field.fallback})`}
                  disabled={!canManage}
                  fullWidth
                />
              );
            }
            return (
              <TextField
                key={field.key}
                label={field.label}
                value={current}
                onChange={(e) => onChange(field.key, e.target.value)}
                helperText={field.help}
                multiline={field.multiline}
                minRows={field.multiline ? 3 : undefined}
                disabled={!canManage}
                fullWidth
              />
            );
          })}

          <Stack spacing={1}>
            <Typography variant="body2" fontWeight={600}>
              Icon
            </Typography>
            <Typography variant="body2" color="text.secondary">
              A plain PNG, {ICON_SIZE} by {ICON_SIZE} pixels. Without one, the pass uses a plain square.
            </Typography>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
              <Button component="label" variant="outlined" disabled={!canManage}>
                Choose PNG
                <input hidden type="file" accept="image/png" onChange={handleIcon} />
              </Button>
              {icon && (
                <Button color="inherit" onClick={() => onChange(ICON_KEY, '')} disabled={!canManage}>
                  Use the plain square
                </Button>
              )}
            </Stack>
            {iconError && <Alert severity="error">{iconError}</Alert>}
          </Stack>
        </Stack>

        <Box sx={{ width: { xs: '100%', md: 260 }, flexShrink: 0 }}>
          <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>
            Preview
          </Typography>
          <Box
            sx={{
              borderRadius: 3,
              p: 2.5,
              minHeight: 170,
              background: preview.background,
              color: preview.color,
              boxShadow: 2,
            }}
            aria-label="Pass preview"
          >
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 2 }}>
              {icon ? (
                <Box component="img" src={`data:image/png;base64,${icon}`} alt="" sx={{ width: 29, height: 29, borderRadius: 1 }} />
              ) : (
                <Box sx={{ width: 29, height: 29, borderRadius: 1, bgcolor: preview.background, border: 1, borderColor: preview.color }} />
              )}
              <Typography variant="body2" fontWeight={600} sx={{ color: preview.color }}>
                {organizationName || 'Your charging network'}
              </Typography>
            </Stack>
            <Typography variant="caption" sx={{ display: 'block', color: preview.label, letterSpacing: 0.5 }}>
              {value('wallet.design.primaryLabel') || DESIGN_FIELDS[3].fallback}
            </Typography>
            <Typography variant="h6" sx={{ color: preview.color, fontWeight: 600 }}>
              {value('wallet.design.primaryValue') || 'Tap to charge'}
            </Typography>
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Approximate. Apple Wallet and Google Wallet lay out the pass themselves.
          </Typography>
        </Box>
      </Stack>
    </Paper>
  );
}
