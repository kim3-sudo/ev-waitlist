import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Container,
  Divider,
  FormControl,
  FormControlLabel,
  FormLabel,
  MenuItem,
  Paper,
  Radio,
  RadioGroup,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

const PROVIDERS = [
  { value: 'NONE', label: 'None (record charges only, no card payments)', help: 'Charges are recorded for your records. Drivers get no payment link.' },
  { value: 'STRIPE', label: 'Stripe', help: 'Drivers pay on a Stripe-hosted page. Card details never reach this server.', guide: '/help/stripe-setup' },
  { value: 'BRAINTREE', label: 'Braintree', help: 'Drivers pay in an embedded Braintree form. Card details go straight to Braintree.', guide: '/help/braintree-setup' },
  { value: 'SQUARE', label: 'Square', help: 'Drivers pay on a Square-hosted checkout page. Card details never reach this server.', guide: '/help/square-setup' },
];

const STATUS_STYLE = {
  PENDING: { label: 'Awaiting payment', color: 'warning' },
  PAID: { label: 'Paid', color: 'success' },
  NEEDS_REVIEW: { label: 'Needs review', color: 'error' },
  NO_CHARGE: { label: 'No charge', color: 'default' },
};

const hourLabel = (h) => `${String(h).padStart(2, '0')}:00`;
const toDollars = (cents) => (cents == null ? '' : (cents / 100).toFixed(2));
const toCents = (text) => (text === '' || text == null ? null : Math.round(Number.parseFloat(text) * 100));

export function AdminPaymentsPage() {
  const { can } = useAuth();
  const canManage = can('payments.manage');
  const [settings, setSettings] = useState(null);
  const [providers, setProviders] = useState({});
  const [form, setForm] = useState(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);
  const [charges, setCharges] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');

  async function loadSettings() {
    const { data } = await api.get('/api/admin/payments/settings');
    setSettings(data.settings);
    setProviders(data.providers);
    setForm({
      pricingModel: data.settings.pricingModel,
      currency: data.settings.currency,
      ratePerMinute: toDollars(data.settings.ratePerMinuteCents),
      peakRatePerMinute: toDollars(data.settings.peakRatePerMinuteCents),
      peakStartHour: data.settings.peakStartHour ?? '',
      peakEndHour: data.settings.peakEndHour ?? '',
      ratePerKwh: toDollars(data.settings.ratePerKwhCents),
      provider: data.settings.provider,
    });
  }

  async function loadCharges() {
    const { data } = await api.get('/api/admin/payments/charges', {
      params: statusFilter ? { status: statusFilter } : {},
    });
    setCharges(data);
  }

  useEffect(() => {
    loadSettings().catch(() => setError('Could not load payment settings.'));
  }, []);

  useEffect(() => {
    loadCharges().catch(() => {});
  }, [statusFilter]);

  function update(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setSaving(true);
    try {
      const payload = {
        pricingModel: form.pricingModel,
        currency: form.currency.toUpperCase(),
        ratePerMinuteCents: toCents(form.ratePerMinute) ?? 0,
        peakRatePerMinuteCents: toCents(form.peakRatePerMinute),
        peakStartHour: form.peakStartHour === '' ? null : Number(form.peakStartHour),
        peakEndHour: form.peakEndHour === '' ? null : Number(form.peakEndHour),
        ratePerKwhCents: toCents(form.ratePerKwh) ?? 0,
        provider: form.provider,
        energyPricingAcknowledged: acknowledged,
      };
      const { data } = await api.put('/api/admin/payments/settings', payload);
      setSettings(data.settings);
      setProviders(data.providers);
      setAcknowledged(false);
      setSuccess('Payment settings saved.');
      loadCharges();
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not save payment settings.');
    } finally {
      setSaving(false);
    }
  }

  if (!form) {
    return (
      <Container maxWidth="md" sx={{ py: 4 }}>
        {error ? <Alert severity="error">{error}</Alert> : null}
      </Container>
    );
  }

  const energyAlreadyAcknowledged = Boolean(settings?.energyPricingAcknowledgedAt);
  const needsAck = form.pricingModel === 'ENERGY' && !energyAlreadyAcknowledged;
  const saveDisabled = saving || !canManage || (needsAck && !acknowledged);

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Typography variant="h5" fontWeight={600} gutterBottom>
        Payments
      </Typography>

      <Stack spacing={3} direction={{ xs: 'column', lg: 'row' }} sx={{ alignItems: 'flex-start' }}>
        <Paper variant="outlined" sx={{ p: 3, flex: 1, minWidth: 0, width: '100%' }}>
          <form onSubmit={handleSubmit}>
            <Stack spacing={3}>
              {error && <Alert severity="error">{error}</Alert>}
              {success && <Alert severity="success">{success}</Alert>}
              {!canManage && <Alert severity="info">You can view pricing, but your role can't change it.</Alert>}

              <FormControl disabled={!canManage}>
                <FormLabel>How should drivers be charged?</FormLabel>
                <RadioGroup value={form.pricingModel} onChange={update('pricingModel')}>
                  <FormControlLabel value="TIME" control={<Radio />} label="By time (per minute connected)" />
                  <FormControlLabel value="ENERGY" control={<Radio />} label="By power dispensed (per kWh)" />
                </RadioGroup>
              </FormControl>

              {form.pricingModel === 'TIME' && (
                <Stack spacing={2}>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                    <TextField
                      label="Price per minute"
                      value={form.ratePerMinute}
                      onChange={update('ratePerMinute')}
                      slotProps={{ input: { startAdornment: form.currency + ' ' } }}
                      disabled={!canManage}
                      fullWidth
                    />
                    <TextField
                      label="Peak price per minute (optional)"
                      helperText="Demand pricing: used during the peak hours below."
                      value={form.peakRatePerMinute}
                      onChange={update('peakRatePerMinute')}
                      slotProps={{ input: { startAdornment: form.currency + ' ' } }}
                      disabled={!canManage}
                      fullWidth
                    />
                  </Stack>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                    <TextField select label="Peak starts" value={form.peakStartHour} onChange={update('peakStartHour')} disabled={!canManage} fullWidth>
                      <MenuItem value="">No peak</MenuItem>
                      {Array.from({ length: 24 }, (_, h) => (
                        <MenuItem key={h} value={h}>{hourLabel(h)}</MenuItem>
                      ))}
                    </TextField>
                    <TextField select label="Peak ends" value={form.peakEndHour} onChange={update('peakEndHour')} disabled={!canManage} fullWidth>
                      <MenuItem value="">No peak</MenuItem>
                      {Array.from({ length: 24 }, (_, h) => (
                        <MenuItem key={h} value={h}>{hourLabel(h)}</MenuItem>
                      ))}
                    </TextField>
                  </Stack>
                  <Typography variant="caption" color="text.secondary">
                    Times use the server's clock. A peak that runs past midnight, such as 22:00 to 06:00, is supported.
                    Each minute is priced by when it happens, and a session is billed for every started minute.
                  </Typography>
                </Stack>
              )}

              {form.pricingModel === 'ENERGY' && (
                <Stack spacing={2}>
                  <Alert severity="warning">
                    <strong>Check before you use this.</strong> Power is billed from the charger's meter reading. Metering
                    depends on what the station supports, and some stations report readings inaccurately or not at all, so
                    the amount may not match the energy delivered. Sessions with no usable reading are marked
                    <em> Needs review</em> instead of being billed.
                    <br />
                    <br />
                    Also check your local laws and ordinances on whether reselling electricity is allowed. Many places
                    restrict it or require a license.
                  </Alert>
                  <TextField
                    label="Price per kWh"
                    value={form.ratePerKwh}
                    onChange={update('ratePerKwh')}
                    slotProps={{ input: { startAdornment: form.currency + ' ' } }}
                    disabled={!canManage}
                    fullWidth
                  />
                  {needsAck && (
                    <FormControlLabel
                      control={<Checkbox checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />}
                      label="I have checked local laws and ordinances, and I understand the metering limits above."
                    />
                  )}
                </Stack>
              )}

              <Divider />

              <TextField
                label="Currency"
                helperText="Three-letter ISO code, such as USD, EUR, or GBP."
                value={form.currency}
                onChange={update('currency')}
                disabled={!canManage}
                slotProps={{ htmlInput: { maxLength: 3 } }}
                sx={{ maxWidth: 200 }}
              />

              <FormControl disabled={!canManage}>
                <FormLabel>Payment provider</FormLabel>
                <RadioGroup value={form.provider} onChange={update('provider')}>
                  {PROVIDERS.map((p) => {
                    const status = providers[p.value];
                    const disabled = p.value !== 'NONE' && !status?.configured;
                    return (
                      <Box key={p.value} sx={{ mb: 1 }}>
                        <FormControlLabel
                          value={p.value}
                          disabled={disabled}
                          control={<Radio />}
                          label={
                            <span>
                              {p.label}{' '}
                              {p.value !== 'NONE' && (
                                <Chip
                                  size="small"
                                  label={status?.configured ? 'Configured' : 'Not configured'}
                                  color={status?.configured ? 'success' : 'default'}
                                  sx={{ ml: 1 }}
                                />
                              )}
                            </span>
                          }
                        />
                        <Typography variant="body2" color="text.secondary" sx={{ ml: 4 }}>
                          {p.help}{' '}
                          {p.guide && (
                            <RouterLink to={p.guide}>Setup guide</RouterLink>
                          )}
                          {p.value !== 'NONE' && !status?.configured && status?.missing?.length > 0 && (
                            <>
                              {' '}Missing keys: {status.missing.join(', ')}. Add them on the{' '}
                              <RouterLink to="/admin/integrations">Integrations</RouterLink> tab.
                            </>
                          )}
                        </Typography>
                      </Box>
                    );
                  })}
                </RadioGroup>
              </FormControl>

              <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
                <Button type="submit" variant="contained" disabled={saveDisabled}>
                  {saving ? 'Saving…' : 'Save payment settings'}
                </Button>
              </Stack>
            </Stack>
          </form>
        </Paper>

        <Paper variant="outlined" sx={{ flex: 1.2, minWidth: 0, width: '100%' }}>
          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', p: 2 }}>
            <Typography variant="subtitle1" fontWeight={600}>
              Charges
            </Typography>
            <TextField select size="small" label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} sx={{ minWidth: 180 }}>
              <MenuItem value="">All</MenuItem>
              {Object.entries(STATUS_STYLE).map(([value, s]) => (
                <MenuItem key={value} value={value}>{s.label}</MenuItem>
              ))}
            </TextField>
          </Stack>
          <Divider />
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>When</TableCell>
                <TableCell>Charge point</TableCell>
                <TableCell>Amount</TableCell>
                <TableCell>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {charges.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} align="center">
                    <Typography color="text.secondary" sx={{ py: 2 }}>No charges yet.</Typography>
                  </TableCell>
                </TableRow>
              )}
              {charges.map((c) => {
                const s = STATUS_STYLE[c.status] ?? { label: c.status, color: 'default' };
                return (
                  <TableRow key={c.id} hover>
                    <TableCell>{new Date(c.createdAt).toLocaleString()}</TableCell>
                    <TableCell>{c.stationName}</TableCell>
                    <TableCell>
                      {new Intl.NumberFormat('en-US', { style: 'currency', currency: c.currency }).format(c.amountCents / 100)}
                      <Typography variant="caption" display="block" color="text.secondary">
                        {c.durationMinutes} min
                        {c.energyKwh != null ? ` · ${c.energyKwh.toFixed(2)} kWh` : ''}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip size="small" label={s.label} color={s.color} variant={c.status === 'PAID' ? 'filled' : 'outlined'} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Paper>
      </Stack>
    </Container>
  );
}
