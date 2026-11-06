import { useEffect, useState } from 'react';
import { Alert, Button, Paper, Stack, TextField, Typography, Divider } from '@mui/material';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

const FIELDS = [
  { key: 'meterSampleSeconds', label: 'Meter reading interval (seconds)', help: 'How often a charge point reports its meter while charging. Set on each charge point when it connects.', min: 10, max: 3600 },
  { key: 'meterToleranceWh', label: 'Tolerance (Wh)', help: 'How far the charge point\'s readings may differ from the end-of-session reading before the session is checked.', min: 0, max: 100000 },
  { key: 'meterTolerancePct', label: 'Tolerance (%)', help: 'The same check, as a share of the session\'s energy. The larger of the two tolerances applies.', min: 0, max: 100 },
  { key: 'meterMinSessionMinutes', label: 'Minimum session length (minutes)', help: 'Sessions at least this long with no usable reading are flagged for review rather than billed as free.', min: 0, max: 1440 },
  { key: 'meterMaxJumpWh', label: 'Largest single step (Wh)', help: 'A reading that jumps by more than this between two samples is not trusted.', min: 100, max: 1000000 },
];

// The meter-reading settings for the energy billing check. Saved on their own, so changing
// them never needs the price confirmation.
export function MeterReadingsSettings() {
  const { can } = useAuth();
  const canManage = can('payments.manage');
  const [values, setValues] = useState(null);
  const [message, setMessage] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/api/admin/payments/settings').then(({ data }) => {
      const s = data.settings;
      setValues(Object.fromEntries(FIELDS.map((f) => [f.key, String(s[f.key])])));
    });
  }, []);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const body = Object.fromEntries(FIELDS.map((f) => [f.key, Number(values[f.key])]));
      await api.put('/api/admin/payments/meter', body);
      setMessage({ kind: 'success', text: 'Meter reading settings saved.' });
    } catch (err) {
      setMessage({ kind: 'error', text: err.response?.data?.error ?? 'Could not save the meter reading settings.' });
    } finally {
      setSaving(false);
    }
  }

  if (!values) return null;

  return (
    <Paper variant="outlined" sx={{ p: 3, mt: 3 }}>
      <Typography variant="subtitle1" fontWeight={600}>Meter readings</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Where a charge point reports its meter, its readings are checked against the end-of-session reading before a session is billed. A reading of zero is never billed on its own.
      </Typography>
      <Divider sx={{ mb: 2 }} />
      {message && <Alert severity={message.kind === 'error' ? 'error' : 'success'} sx={{ mb: 2 }}>{message.text}</Alert>}
      <Stack spacing={2}>
        {FIELDS.map((f) => (
          <TextField
            key={f.key}
            label={f.label}
            type="number"
            value={values[f.key]}
            helperText={f.help}
            disabled={!canManage}
            onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
            inputProps={{ min: f.min, max: f.max, step: 1 }}
          />
        ))}
        {canManage && (
          <Stack direction="row" justifyContent="flex-end">
            <Button variant="contained" onClick={save} disabled={saving}>Save meter settings</Button>
          </Stack>
        )}
      </Stack>
    </Paper>
  );
}
