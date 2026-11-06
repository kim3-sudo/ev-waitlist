import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  FormHelperText,
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
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { api } from '../api/client.js';
import { MeterReadingsSettings } from '../components/MeterReadingsSettings.jsx';
import { useAuth } from '../context/AuthContext.jsx';

const PROVIDERS = [
  { value: 'NONE', label: 'None (record charges only, no card payments)', help: 'Charges are recorded for your records. Drivers get no payment link.' },
  { value: 'STRIPE', label: 'Stripe', help: 'Drivers pay on a Stripe-hosted page. Card details never reach this server. Supports card holds.', guide: '/help/stripe-setup' },
  { value: 'BRAINTREE', label: 'Braintree', help: 'Drivers pay in an embedded Braintree form. Card details go straight to Braintree. Supports card holds.', guide: '/help/braintree-setup' },
  { value: 'SQUARE', label: 'Square', help: 'Drivers pay on a Square-hosted checkout page. Card details never reach this server. Does not support card holds.', guide: '/help/square-setup' },
];

const STATUS_STYLE = {
  PENDING: { label: 'Awaiting payment', color: 'warning' },
  PAID: { label: 'Paid', color: 'success' },
  NEEDS_REVIEW: { label: 'Needs review', color: 'error' },
  NO_CHARGE: { label: 'No charge', color: 'default' },
};

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DEFAULT_POWER_KW = '7.4';

// The costs the rate calculator asks for. Money fields are per kWh or per month, in the currency.
const CALC_MONEY_FIELDS = [
  { key: 'energyCost', label: 'Energy cost from the grid, per kWh', help: 'What you pay your utility or supplier for each kWh bought from the grid.' },
  { key: 'distribution', label: 'Distribution or network charge, per kWh', help: 'Delivery charges on each grid kWh, if your bill has them.' },
  { key: 'solarCost', label: 'Solar running cost, per kWh', help: 'Maintenance and other running costs per solar kWh. Often zero.' },
  { key: 'customerCharge', label: 'Account or meter charge, per month', help: 'Fixed monthly charges for the connection and meter.' },
  { key: 'infrastructure', label: 'Charger costs, per month', help: 'Lease, maintenance, network, and any demand or capacity charges for the chargers.' },
];
const CALC_BLANK = {
  energyCost: '', distribution: '', solarCost: '', customerCharge: '', infrastructure: '',
  solarKw: '', solarYield: '', monthlyKwh: '', margin: '',
};

const hourLabel = (h) => `${String(h).padStart(2, '0')}:00`;
const toDollars = (cents) => (cents == null ? '' : (cents / 100).toFixed(2));
const toCents = (text) => (text === '' || text == null ? null : Math.round(Number.parseFloat(text) * 100));
const money = (cents, currency) => new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);

let rowKey = 0;
const newKey = () => {
  rowKey += 1;
  return `row-${rowKey}`;
};

function calcFromInputs(inputs) {
  if (!inputs) return { ...CALC_BLANK };
  return {
    energyCost: toDollars(inputs.energyCostPerKwhCents),
    distribution: toDollars(inputs.distributionPerKwhCents),
    solarCost: toDollars(inputs.solarCostPerKwhCents),
    customerCharge: toDollars(inputs.customerChargePerMonthCents),
    infrastructure: toDollars(inputs.infrastructurePerMonthCents),
    solarKw: inputs.solarKw ? String(inputs.solarKw) : '',
    solarYield: inputs.solarKwhPerKwPerYear ? String(inputs.solarKwhPerKwPerYear) : '',
    monthlyKwh: inputs.monthlyKwh ? String(inputs.monthlyKwh) : '',
    margin: inputs.marginPercent ? String(inputs.marginPercent) : '',
  };
}

// Calculator inputs for the server, or null when the admin has not entered any.
function calcPayload(calc) {
  if (Object.values(calc).every((v) => v === '')) return null;
  const cents = (v) => toCents(v) ?? 0;
  return {
    energyCostPerKwhCents: cents(calc.energyCost),
    distributionPerKwhCents: cents(calc.distribution),
    solarCostPerKwhCents: cents(calc.solarCost),
    customerChargePerMonthCents: cents(calc.customerCharge),
    infrastructurePerMonthCents: cents(calc.infrastructure),
    solarKw: Number(calc.solarKw) || 0,
    solarKwhPerKwPerYear: Number(calc.solarYield) || 0,
    monthlyKwh: Number(calc.monthlyKwh) || 0,
    marginPercent: Number(calc.margin) || 0,
  };
}

function scheduleRows(list) {
  return (list ?? []).map((w) => ({
    key: newKey(),
    days: w.days,
    startHour: w.startHour,
    endHour: w.endHour,
    rate: toDollars(w.rate),
  }));
}

function formFrom(data) {
  const s = data.settings;
  return {
    pricingModel: s.pricingModel,
    timeBillingUnit: s.timeBillingUnit ?? 'MINUTE',
    currency: s.currency,
    ratePerMinute: toDollars(s.ratePerMinuteCents),
    ratePerKwh: toDollars(s.ratePerKwhCents),
    provider: s.provider,
    referencePowerKw: s.referencePowerKw == null ? DEFAULT_POWER_KW : String(s.referencePowerKw),
    preauth: toDollars(s.preauthCents),
    schedule: scheduleRows(data.schedule),
    calc: calcFromInputs(data.calculatorInputs),
  };
}

// What the server needs to save or preview the form.
function payloadFrom(form, { acknowledged, highRateConfirmed }) {
  return {
    pricingModel: form.pricingModel,
    timeBillingUnit: form.timeBillingUnit,
    currency: form.currency.toUpperCase(),
    ratePerMinuteCents: toCents(form.ratePerMinute) ?? 0,
    ratePerKwhCents: toCents(form.ratePerKwh) ?? 0,
    rateSchedule: form.schedule.map((w) => ({
      days: w.days,
      startHour: Number(w.startHour),
      endHour: Number(w.endHour),
      rate: toCents(w.rate),
    })),
    referencePowerKw: Number(form.referencePowerKw) || null,
    rateCalculatorInputs: calcPayload(form.calc),
    preauthCents: form.preauth === '' ? null : toCents(form.preauth),
    provider: form.provider,
    energyPricingAcknowledged: acknowledged,
    highRateConfirmed,
  };
}

// The price check, in plain words. Warns hardest for Level 2 chargers.
function PriceCheck({ check, pricingModel, confirmed, onConfirm, canManage }) {
  if (pricingModel === 'FREE' || !check) return null;
  if (check.level === 'NONE') {
    return (
      <Alert severity="info">
        Price check: use the rate calculator below to compare your price with what the energy costs.
      </Alert>
    );
  }
  const times = check.ratio.toFixed(1);
  if (check.level === 'OK') {
    return <Alert severity="success">Price check: the highest price is {times} times what the energy costs. That is within the usual range.</Alert>;
  }
  const strong = check.level === 'STRONG';
  const level2 = check.powerKw <= 22;
  return (
    <Alert severity={strong ? 'error' : 'warning'}>
      <strong>{strong ? 'This price is far above the energy cost.' : 'This price is high for the energy cost.'}</strong>{' '}
      The highest price is {times} times what the energy costs{level2 ? ' on a Level 2 charger' : ''}. Check the rate and the
      charger power before you save.
      <FormControlLabel
        sx={{ display: 'flex', mt: 1 }}
        control={<Checkbox checked={confirmed} onChange={(e) => onConfirm(e.target.checked)} disabled={!canManage} />}
        label="I've checked this rate and want to save it anyway."
      />
    </Alert>
  );
}

// Converts a rate typed in one time unit to the other (per minute to per hour is times 60).
function convertRate(text, factor) {
  if (text === '' || text == null) return text;
  const n = Number.parseFloat(text);
  return Number.isNaN(n) ? text : (n * factor).toFixed(2);
}

function ScheduleEditor({ rows, onChange, currency, disabled, unit = 'MINUTE' }) {
  const unitWord = unit === 'HOUR' ? 'hour' : 'minute';
  const update = (key, patch) => onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const remove = (key) => onChange(rows.filter((r) => r.key !== key));
  const add = () => onChange([...rows, { key: newKey(), days: [1, 2, 3, 4, 5], startHour: 0, endHour: 24, rate: '' }]);

  return (
    <Stack spacing={2}>
      <Typography variant="subtitle2" fontWeight={600}>Time-of-day rates (optional)</Typography>
      <Typography variant="caption" color="text.secondary">
        A {unitWord} that starts inside a time window is charged at that window's price. Other {unitWord}s use the base price.
        Windows can't overlap. A window that runs past midnight, such as 22:00 to 06:00, is supported. Times use the
        server's clock. For example, a lower price on weekends is one window on Saturday and Sunday.
      </Typography>
      {rows.length === 0 && <Typography variant="body2" color="text.secondary">No time windows. The base price applies all the time.</Typography>}
      {rows.map((r) => (
        <Paper key={r.key} variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={2}>
            <ToggleButtonGroup
              size="small"
              value={r.days}
              onChange={(_, days) => update(r.key, { days: [...days].sort((a, b) => a - b) })}
              disabled={disabled}
              aria-label="Days"
            >
              {DAY_LABELS.map((label, d) => (
                <ToggleButton key={label} value={d} aria-label={DAY_NAMES[d]}>{label}</ToggleButton>
              ))}
            </ToggleButtonGroup>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                select
                label="From"
                value={r.startHour}
                onChange={(e) => update(r.key, { startHour: Number(e.target.value) })}
                disabled={disabled}
                fullWidth
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <MenuItem key={h} value={h}>{hourLabel(h)}</MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label="Until"
                value={r.endHour}
                onChange={(e) => update(r.key, { endHour: Number(e.target.value) })}
                disabled={disabled}
                fullWidth
              >
                {Array.from({ length: 25 }, (_, h) => (
                  <MenuItem key={h} value={h}>{h === 24 ? 'midnight (24:00)' : hourLabel(h)}</MenuItem>
                ))}
              </TextField>
              <TextField
                label={`Price per ${unitWord}`}
                value={r.rate}
                onChange={(e) => update(r.key, { rate: e.target.value })}
                slotProps={{ input: { startAdornment: `${currency} ` } }}
                disabled={disabled}
                fullWidth
              />
            </Stack>
            <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
              <Button color="error" size="small" onClick={() => remove(r.key)} disabled={disabled}>
                Remove this window
              </Button>
            </Stack>
          </Stack>
        </Paper>
      ))}
      <Stack direction="row">
        <Button variant="outlined" onClick={add} disabled={disabled}>Add a time window</Button>
      </Stack>
    </Stack>
  );
}

// Shows whether the calculator's inputs are saved yet.
function SaveStatus({ state }) {
  if (state.state === 'saving') {
    return (
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <CircularProgress size={16} />
        <Typography variant="body2" color="text.secondary">Saving…</Typography>
      </Stack>
    );
  }
  if (state.state === 'error') {
    return <Alert severity="error">Could not save the calculator. {state.message}</Alert>;
  }
  if (state.state === 'saved') {
    return <Typography variant="body2" color="success.main">Saved automatically.</Typography>;
  }
  return <Typography variant="body2" color="text.secondary">Changes are saved automatically as you type.</Typography>;
}

function RateCalculatorDialog({ open, onClose, calc, onCalc, result, marginText, powerKw, currency, onUse, disabled, unit, saveState, isDefault }) {
  const set = (key) => (e) => onCalc({ ...calc, [key]: e.target.value });
  const kw = Number(powerKw) || Number(DEFAULT_POWER_KW);
  // Per-minute prices are whole cents, so one cent a minute is this many cents per kWh at this power.
  const perHour = unit === 'HOUR';
  const centsPerKwhPerCent = (perHour ? 100 : 6000) / kw;
  const perUnit = perHour ? 'hour' : 'minute';

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md" aria-labelledby="calc-title">
      <DialogTitle id="calc-title">Energy cost calculator</DialogTitle>
      <DialogContent>
        <Stack spacing={3} sx={{ mt: 1 }}>
          <SaveStatus state={saveState} />
          {isDefault && (
            <Alert severity="info">
              These are conservative starting values: the costs are set on the high side, so the price is not set below the
              real cost. Replace them with your own figures from your bills.
            </Alert>
          )}
          <Typography variant="body2" color="text.secondary">
            Enter what the energy costs you. The calculator works out the cost of each kWh, spreads the monthly charges
            over the energy you expect to sell, and adds your profit margin. It is a planning aid. Check the figures
            against your bills.
          </Typography>
          <Stack spacing={2}>
            {CALC_MONEY_FIELDS.map((f) => (
              <TextField
                key={f.key}
                label={f.label}
                helperText={f.help}
                value={calc[f.key]}
                onChange={set(f.key)}
                slotProps={{ input: { startAdornment: `${currency} ` } }}
                disabled={disabled}
              />
            ))}
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Solar capacity (kW)"
              helperText="Installed panel capacity. Leave empty if you have none."
              value={calc.solarKw}
              onChange={set('solarKw')}
              disabled={disabled}
              fullWidth
            />
            <TextField
              label="Solar yield (kWh per kW per year)"
              helperText="Typically 900 to 1,600, depending on location."
              value={calc.solarYield}
              onChange={set('solarYield')}
              disabled={disabled}
              fullWidth
            />
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Energy expected to be sold per month (kWh)"
              helperText="Be realistic. Monthly charges are spread over this amount."
              value={calc.monthlyKwh}
              onChange={set('monthlyKwh')}
              disabled={disabled}
              fullWidth
            />
            <TextField
              label="Profit margin (%)"
              helperText="Added on top of the cost. For example, 20 gives a price 25% above cost."
              value={calc.margin}
              onChange={set('margin')}
              disabled={disabled}
              fullWidth
            />
          </Stack>

          <Paper variant="outlined" sx={{ p: 2, bgcolor: 'action.hover' }}>
            {result ? (
              <Stack spacing={1}>
                <Typography>Cost of the energy: <strong>{money(result.costPerKwhCents, currency)} per kWh</strong></Typography>
                <Typography>
                  Price with a {marginText}% margin: <strong>{money(result.pricePerKwhCents, currency)} per kWh</strong>
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  At {kw} kW, that is about{' '}
                  {money(perHour ? result.pricePerKwhCents * kw : (result.pricePerKwhCents * kw) / 60, currency)} per {perUnit}.
                  Base prices are whole cents, so at this power one cent per {perUnit} is about {centsPerKwhPerCent.toFixed(1)}{' '}
                  cents per kWh.
                </Typography>
                {result.solarKwhPerMonth > 0 && (
                  <Typography variant="body2" color="text.secondary">
                    Solar covers about {Math.round(result.solarKwhPerMonth)} kWh a month. The grid covers the other{' '}
                    {Math.round(result.gridKwhPerMonth)} kWh.
                  </Typography>
                )}
                <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
                  <Button variant="outlined" onClick={onUse} disabled={disabled}>Use this price</Button>
                </Stack>
              </Stack>
            ) : (
              <Typography color="text.secondary">Enter the expected monthly energy and the costs to see a price.</Typography>
            )}
          </Paper>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Done</Button>
      </DialogActions>
    </Dialog>
  );
}

export function AdminPaymentsPage() {
  const { can } = useAuth();
  const canManage = can('payments.manage');
  const [settings, setSettings] = useState(null);
  const [providers, setProviders] = useState({});
  const [form, setForm] = useState(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [highRateConfirmed, setHighRateConfirmed] = useState(false);
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);
  const [charges, setCharges] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [calcOpen, setCalcOpen] = useState(false);
  // The calculator saves itself: calcDirty is set when the admin edits it, and not when the page loads.
  const [calcDirty, setCalcDirty] = useState(false);
  const [calcSave, setCalcSave] = useState({ state: 'idle' });
  const [calcIsDefault, setCalcIsDefault] = useState(false);

  async function loadSettings() {
    const { data } = await api.get('/api/admin/payments/settings');
    setSettings(data.settings);
    setProviders(data.providers);
    setForm(formFrom(data));
    setCalcIsDefault(Boolean(data.calculatorIsDefault));
    setPreview({ check: data.check, calculator: data.calculator, schedule: data.schedule });
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

  // While the admin types, work out the calculator and price check for the unsaved form.
  useEffect(() => {
    // Viewers can't preview (the preview endpoint needs payments.manage), so they keep the saved figures.
    if (!form || !canManage) return undefined;
    const timer = setTimeout(async () => {
      try {
        const { data } = await api.post('/api/admin/payments/preview', payloadFrom(form, { acknowledged, highRateConfirmed }));
        setPreview(data);
        setPreviewError('');
      } catch (err) {
        setPreviewError(err.response?.data?.error ?? '');
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [form, acknowledged, canManage]);

  // Saves the calculator's inputs as the admin types, after a short pause. Only the cost
  // inputs are saved, so the price itself does not change.
  useEffect(() => {
    if (!calcDirty || !form || !canManage) return undefined;
    setCalcSave({ state: 'saving' });
    const timer = setTimeout(async () => {
      try {
        const { data } = await api.put('/api/admin/payments/calculator', {
          rateCalculatorInputs: calcPayload(form.calc),
        });
        setCalcIsDefault(false);
        setCalcSave({ state: 'saved' });
        setPreview((p) => ({ ...p, check: data.check, calculator: data.calculator }));
      } catch (err) {
        setCalcSave({ state: 'error', message: err.response?.data?.error ?? 'Check the figures and try again.' });
      }
    }, 700);
    return () => clearTimeout(timer);
  }, [form?.calc, calcDirty, canManage]);

  function update(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  // Changes the time unit and converts the typed rates, so the price stays the same.
  function setTimeUnit(unit) {
    if (!unit || unit === form.timeBillingUnit) return;
    const factor = unit === 'HOUR' ? 60 : 1 / 60;
    setForm((f) => ({
      ...f,
      timeBillingUnit: unit,
      ratePerMinute: convertRate(f.ratePerMinute, factor),
      schedule: f.schedule.map((w) => ({ ...w, rate: convertRate(w.rate, factor) })),
    }));
  }

  function editCalculator(calc) {
    setForm((f) => ({ ...f, calc }));
    setCalcDirty(true);
  }

  function useCalculatedPrice() {
    const price = preview?.calculator?.pricePerKwhCents;
    if (price == null) return;
    if (form.pricingModel === 'ENERGY') {
      setForm((f) => ({ ...f, ratePerKwh: (price / 100).toFixed(2) }));
    } else {
      // Base prices are whole cents per unit. Per hour is the cost at this power; per minute is that divided by 60.
      const kw = Number(form.referencePowerKw) || Number(DEFAULT_POWER_KW);
      const perUnit = form.timeBillingUnit === 'HOUR' ? price * kw : (price * kw) / 60;
      setForm((f) => ({ ...f, ratePerMinute: (Math.round(perUnit) / 100).toFixed(2) }));
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setSaving(true);
    try {
      const { data } = await api.put('/api/admin/payments/settings', payloadFrom(form, { acknowledged, highRateConfirmed }));
      setSettings(data.settings);
      setProviders(data.providers);
      setAcknowledged(false);
      setHighRateConfirmed(false);
      setForm(formFrom(data));
      setCalcDirty(false);
      setCalcIsDefault(Boolean(data.calculatorIsDefault));
      setPreview({ check: data.check, calculator: data.calculator, schedule: data.schedule });
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
  const check = preview?.check;
  const needsHighRateConfirm = form.pricingModel !== 'FREE' && (check?.level === 'WARN' || check?.level === 'STRONG');
  const saveDisabled = saving || !canManage || (needsAck && !acknowledged) || (needsHighRateConfirm && !highRateConfirmed);
  const unitWord = form.timeBillingUnit === 'HOUR' ? 'hour' : 'minute';
  const holdProviderOk = form.provider === 'STRIPE' || form.provider === 'BRAINTREE';
  const holdsDisabled = !canManage || form.pricingModel === 'FREE' || !holdProviderOk;

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
              {previewError && previewError.includes('local laws') === false && (
                <Alert severity="warning">Fix this before saving: {previewError}</Alert>
              )}
              {!canManage && <Alert severity="info">You can view pricing, but your role can't change it.</Alert>}

              <FormControl disabled={!canManage}>
                <FormLabel>How should drivers be charged?</FormLabel>
                <RadioGroup value={form.pricingModel} onChange={update('pricingModel')}>
                  <FormControlLabel value="TIME" control={<Radio />} label="By time (per minute connected)" />
                  <FormControlLabel value="ENERGY" control={<Radio />} label="By power dispensed (per kWh)" />
                  <FormControlLabel value="FREE" control={<Radio />} label="Don't charge drivers (free charging)" />
                </RadioGroup>
              </FormControl>

              {form.pricingModel === 'FREE' && (
                <Alert severity="info">
                  Drivers aren't charged. Sessions are still recorded, as <em>No charge</em>, for your records. No payment
                  link is sent.
                </Alert>
              )}

              {form.pricingModel === 'TIME' && (
                <Stack spacing={2}>
                  <Alert severity="warning">
                    <strong>Check before you use time-based pricing.</strong> Billing by time charges drivers for how long
                    they are connected, not for the energy they receive. A nearly full battery or a slow-charging car pays
                    the same per minute as any other. Some places require EV charging to be billed by energy, or set rules on
                    how it is measured. Check your local rules first.
                  </Alert>
                  <FormControl disabled={!canManage}>
                    <FormLabel>Bill the base price per</FormLabel>
                    <ToggleButtonGroup
                      exclusive
                      size="small"
                      value={form.timeBillingUnit}
                      onChange={(_, unit) => setTimeUnit(unit)}
                      aria-label="Time billing unit"
                      sx={{ mt: 1, alignSelf: 'flex-start' }}
                    >
                      <ToggleButton value="MINUTE">Minute</ToggleButton>
                      <ToggleButton value="HOUR">Hour</ToggleButton>
                    </ToggleButtonGroup>
                    <FormHelperText>
                      {form.timeBillingUnit === 'HOUR'
                        ? 'Each started hour is billed. A session of 1 hour and 10 minutes pays for two hours.'
                        : 'Each started minute is billed. Switching the unit converts the prices you have typed.'}
                    </FormHelperText>
                  </FormControl>
                  <TextField
                    label={`Base price per ${unitWord}`}
                    value={form.ratePerMinute}
                    onChange={update('ratePerMinute')}
                    slotProps={{ input: { startAdornment: form.currency + ' ' } }}
                    disabled={!canManage}
                    helperText={`Used for every ${unitWord} that is not in a time window below.`}
                    fullWidth
                  />
                  <ScheduleEditor
                    rows={form.schedule}
                    onChange={(schedule) => setForm((f) => ({ ...f, schedule }))}
                    currency={form.currency}
                    disabled={!canManage}
                    unit={form.timeBillingUnit}
                  />
                  <Typography variant="caption" color="text.secondary">
                    {form.timeBillingUnit === 'HOUR'
                      ? 'Each hour is priced by when it starts, and a session is billed for every started hour.'
                      : 'Each minute is priced by when it happens, and a session is billed for every started minute.'}
                  </Typography>
                </Stack>
              )}

              {form.pricingModel === 'ENERGY' && (
                <Stack spacing={2}>
                  <Alert severity="warning">
                    <strong>Check before you use this.</strong> Power is billed from the charger's meter reading. Metering
                    depends on what the station supports, and some stations report readings inaccurately or not at all, so
                    the amount may not match the energy delivered. Sessions with no usable reading are marked
                    <em> Needs review</em> instead of being billed. One price applies to all energy, so time windows do not
                    apply to this model.
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

              {form.pricingModel !== 'FREE' && (
                <Stack spacing={2}>
                  <TextField
                    label="Charger power for the price check (kW)"
                    helperText="The power of a typical charger here. 7.4 kW is a common Level 2 (single-phase, 32 A) charger. Used to compare a per-minute price with the cost per kWh."
                    value={form.referencePowerKw}
                    onChange={update('referencePowerKw')}
                    disabled={!canManage}
                    sx={{ maxWidth: 320 }}
                  />
                  <PriceCheck
                    check={check}
                    pricingModel={form.pricingModel}
                    confirmed={highRateConfirmed}
                    onConfirm={setHighRateConfirmed}
                    canManage={canManage}
                  />
                </Stack>
              )}

              <Paper variant="outlined" sx={{ p: 2 }}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
                  <Stack sx={{ flexGrow: 1 }}>
                    <Typography fontWeight={600}>Energy cost calculator</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {preview?.calculator
                        ? `The energy costs about ${money(preview.calculator.costPerKwhCents, form.currency)} per kWh, so a price with your margin is ${money(preview.calculator.pricePerKwhCents, form.currency)} per kWh.`
                        : 'Enter what the energy costs you to see a price.'}
                    </Typography>
                  </Stack>
                  <Button variant="outlined" onClick={() => setCalcOpen(true)}>
                    Open calculator
                  </Button>
                </Stack>
              </Paper>

              <RateCalculatorDialog
                open={calcOpen}
                onClose={() => setCalcOpen(false)}
                calc={form.calc}
                onCalc={editCalculator}
                result={preview?.calculator}
                marginText={form.calc.margin || '0'}
                powerKw={form.referencePowerKw}
                currency={form.currency}
                onUse={useCalculatedPrice}
                disabled={!canManage}
                unit={form.timeBillingUnit}
                saveState={canManage ? calcSave : { state: 'idle' }}
                isDefault={calcIsDefault && !calcDirty}
              />

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
                      <Stack key={p.value} sx={{ mb: 1 }}>
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
                              <RouterLink to="/admin/integrations">Payment providers</RouterLink>.
                            </>
                          )}
                        </Typography>
                      </Stack>
                    );
                  })}
                </RadioGroup>
              </FormControl>

              <Divider />

              <Stack spacing={2}>
                <Typography variant="subtitle2" fontWeight={600}>Card hold before charging (optional)</Typography>
                <TextField
                  label="Amount to hold on the driver's card"
                  helperText={
                    holdProviderOk
                      ? 'Reserved on the card before a waitlisted driver starts. The driver pays only the actual cost; the rest of the hold is released. Leave empty to take payment after the session.'
                      : 'Needs Stripe or Braintree as the payment provider. Square and "None" cannot place a hold.'
                  }
                  value={form.preauth}
                  onChange={update('preauth')}
                  slotProps={{ input: { startAdornment: form.currency + ' ' } }}
                  disabled={holdsDisabled}
                  sx={{ maxWidth: 320 }}
                />
                {form.preauth !== '' && holdProviderOk && form.pricingModel !== 'FREE' && (
                  <Alert severity="info">
                    Drivers are asked to place this hold when they're called, before they plug in. A waitlisted driver
                    who hasn't placed it is not allowed to start. If the card provider lets a hold lapse before the
                    session ends, the driver is sent a normal payment link for the full amount.
                  </Alert>
                )}
              </Stack>

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
                      {money(c.totalCents ?? c.amountCents, c.currency)}
                      <Typography variant="caption" display="block" color="text.secondary">
                        {c.durationMinutes} min
                        {c.energyKwh != null ? ` · ${c.energyKwh.toFixed(2)} kWh` : ''}
                      </Typography>
                      {c.energyNote && (c.status === 'NEEDS_REVIEW' || c.energySource === 'METER_VALUES') && (
                        <Typography variant="caption" display="block" color={c.status === 'NEEDS_REVIEW' ? 'error' : 'text.secondary'}>
                          {c.energyNote}
                        </Typography>
                      )}
                      {c.heldCents > 0 && (
                        <Typography variant="caption" display="block" color="text.secondary">
                          Hold covered {money(c.heldCents, c.currency)}
                          {c.amountCents > 0 ? `, ${money(c.amountCents, c.currency)} still owed` : ''}
                        </Typography>
                      )}
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
      <MeterReadingsSettings />
    </Container>
  );
}
