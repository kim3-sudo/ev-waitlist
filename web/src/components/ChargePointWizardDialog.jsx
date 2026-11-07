import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography,
} from '@mui/material';
import { api } from '../api/client.js';
import { ConnectorFields } from './ConnectorFields.jsx';
import { ConnectionTest } from './ConnectionTest.jsx';
import { CONNECTOR_FORMAT_OPTIONS, CONNECTOR_STANDARD_OPTIONS, POWER_TYPE_OPTIONS, optionFor } from '../connectorOptions.js';

const STEPS = ['Identity', 'Location', 'Connectors', 'Review', 'Connect'];
const REVIEW_STEP = 3;
const CONNECT_STEP = 4;
const POLL_MS = 3000;

// The URL a charge point must connect to. Derived from the API address so it
// matches whatever host/port the server is reachable on.
export function chargePointUrl(identity) {
  const base = api.defaults.baseURL.replace(/^http/, 'ws');
  return `${base}/ocpp/${identity}`;
}

const emptyForm = {
  identity: '',
  name: '',
  location: '',
  vendor: '',
  model: '',
  zoneId: '',
  connectorCount: 1,
  // Connector details keyed by connector number. Optional, but needed for roaming.
  connectors: {},
};

// The connector list sent to the server: one entry per connector, blanks clear a detail.
function connectorsPayload(count, details) {
  return Array.from({ length: Number(count) || 0 }, (_, i) => i + 1).map((connectorId) => ({
    connectorId,
    ...(details[connectorId] ?? {}),
  }));
}

// A one-line summary of a connector for the review step.
function describeConnector(d = {}) {
  const parts = [
    optionFor(CONNECTOR_STANDARD_OPTIONS, d.standard)?.name,
    optionFor(CONNECTOR_FORMAT_OPTIONS, d.format)?.name,
    optionFor(POWER_TYPE_OPTIONS, d.powerType)?.name,
    d.maxVoltage ? `${d.maxVoltage} V` : null,
    d.maxAmperage ? `${d.maxAmperage} A` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : 'Not set yet';
}

function ReviewRow({ label, value }) {
  return (
    <Stack direction="row" spacing={2} sx={{ py: 0.5 }}>
      <Typography variant="body2" color="text.secondary" sx={{ width: 120, flexShrink: 0 }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
        {value || '—'}
      </Typography>
    </Stack>
  );
}

// Guided alternative to the full "Add charge point" form. Walks the admin
// through identity, location, connectors and a review, then waits for the
// charger to connect so the admin knows the setup worked.
// The wizard in a modal, used from the charge points page.
export function ChargePointWizardDialog({ onClose, onCreated, onSwitchToForm }) {
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Add charge point</DialogTitle>
      <DialogContent>
        <ChargePointWizard
          onCancel={onClose}
          onFinish={onClose}
          onCreated={onCreated}
          onSwitchToForm={onSwitchToForm}
        />
      </DialogContent>
    </Dialog>
  );
}

// The wizard steps without a modal, so it can also run inline on a page.
// onCancel: leave the wizard before anything is saved (first step).
// onFinish: the admin is done with the wizard after the charge point is saved.
export function ChargePointWizard({
  onCancel,
  onCreated,
  onSwitchToForm,
  onFinish,
  cancelLabel = 'Cancel',
  finishLabel = 'Close',
}) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(emptyForm);
  const [zones, setZones] = useState([]);
  const [created, setCreated] = useState(null);
  const [online, setOnline] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Zone listing needs zones.view; without it the zone choice is simply hidden.
    api
      .get('/api/admin/zones', { params: { limit: 200 } })
      .then(({ data }) => setZones(data.data))
      .catch(() => setZones([]));
  }, []);

  // After creation, poll the station until the charger connects.
  useEffect(() => {
    if (step !== CONNECT_STEP || !created || online) return undefined;
    const id = setInterval(async () => {
      try {
        const { data } = await api.get(`/api/admin/stations/${created.id}`);
        if (data.online) setOnline(true);
      } catch {
        // Keep polling; a transient error shouldn't end the wait.
      }
    }, POLL_MS);
    return () => clearInterval(id);
  }, [step, created, online]);

  function update(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  function updateConnector(connectorId, field, value) {
    setForm((f) => ({
      ...f,
      connectors: { ...f.connectors, [connectorId]: { ...(f.connectors[connectorId] ?? {}), [field]: value } },
    }));
  }

  async function validateCurrentStep() {
    if (step === 0) {
      const identity = form.identity.trim();
      if (!form.name.trim()) return 'Enter a display name.';
      const { data } = await api.get('/api/admin/stations/identity-check', { params: { identity } });
      if (!data.available) return data.error;
    }
    if (step === 2) {
      const count = Number(form.connectorCount);
      if (!Number.isInteger(count) || count < 1) return 'Connector count must be a whole number, 1 or more.';
    }
    return null;
  }

  async function handleNext() {
    setError('');
    setBusy(true);
    try {
      const problem = await validateCurrentStep();
      if (problem) {
        setError(problem);
        return;
      }
      setStep((s) => s + 1);
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not check that step. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleCreate() {
    setError('');
    setBusy(true);
    try {
      const { data } = await api.post('/api/admin/stations', {
        identity: form.identity.trim(),
        name: form.name.trim(),
        location: form.location.trim(),
        vendor: form.vendor.trim(),
        model: form.model.trim(),
        zoneId: form.zoneId,
        connectorCount: Number(form.connectorCount),
        connectors: connectorsPayload(form.connectorCount, form.connectors),
      });
      setCreated(data);
      setStep(CONNECT_STEP);
      onCreated?.(data);
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not add the charge point.');
    } finally {
      setBusy(false);
    }
  }

  const zoneName = zones.find((z) => z.id === form.zoneId)?.name;

  return (
    <>
        <Stepper activeStep={step} alternativeLabel sx={{ mb: 3, mt: 1 }}>
          {STEPS.map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>

        <Stack spacing={2}>
          {error && <Alert severity="error">{error}</Alert>}

          {step === 0 && (
            <>
              <Typography variant="body2" color="text.secondary">
                The charger connects to the app using this identity, so enter the same ID the charger is configured
                with.
              </Typography>
              <TextField
                label="OCPP identity"
                helperText="Letters, digits, and . _ : - only. Must be unique."
                value={form.identity}
                onChange={update('identity')}
                autoFocus
                required
                fullWidth
              />
              <TextField
                label="Display name"
                helperText="Shown to drivers and admins, e.g. “Garage P1 – Bay 3”"
                value={form.name}
                onChange={update('name')}
                required
                fullWidth
              />
            </>
          )}

          {step === 1 && (
            <>
              <Typography variant="body2" color="text.secondary">
                Where the charger is and what it is. Everything here is optional.
              </Typography>
              <TextField label="Location" value={form.location} onChange={update('location')} fullWidth />
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField label="Vendor" value={form.vendor} onChange={update('vendor')} fullWidth />
                <TextField label="Model" value={form.model} onChange={update('model')} fullWidth />
              </Stack>
              <TextField
                select
                label="Zone"
                helperText="A zone shares one waitlist across its charge points. Leave blank for a standalone charger."
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
            </>
          )}

          {step === 2 && (
            <>
              <Typography variant="body2" color="text.secondary">
                Count each plug the charger can supply as one connector. Most single-plug chargers have 1.
              </Typography>
              <TextField
                label="Connectors"
                type="number"
                value={form.connectorCount}
                onChange={update('connectorCount')}
                slotProps={{ htmlInput: { min: 1, step: 1 } }}
                required
                sx={{ width: 180 }}
              />
              <ConnectorFields
                count={form.connectorCount}
                details={form.connectors}
                onChange={updateConnector}
                intro="Add each connector's details now. Drivers see them on the waitlist, and roaming partners need them to find your charger. You can skip this and add them later."
              />
            </>
          )}

          {step === REVIEW_STEP && (
            <>
              <Typography variant="body2" color="text.secondary">
                Check the details below. Going to the next step saves the charge point.
              </Typography>
              <Stack sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 2 }}>
                <ReviewRow label="Identity" value={form.identity.trim()} />
                <ReviewRow label="Display name" value={form.name.trim()} />
                <ReviewRow label="Location" value={form.location.trim()} />
                <ReviewRow label="Vendor / model" value={[form.vendor.trim(), form.model.trim()].filter(Boolean).join(' ')} />
                <ReviewRow label="Zone" value={form.zoneId ? zoneName : 'Standalone (no zone)'} />
                <ReviewRow label="Connectors" value={String(form.connectorCount)} />
                {connectorsPayload(form.connectorCount, form.connectors).map((c) => (
                  <ReviewRow
                    key={c.connectorId}
                    label={`Connector ${c.connectorId}`}
                    value={describeConnector(form.connectors[c.connectorId])}
                  />
                ))}
              </Stack>
            </>
          )}

          {step === CONNECT_STEP && created && (
            <>
              <Alert severity="success">
                Saved <strong>{created.name}</strong> with {created.connectors.length} connector
                {created.connectors.length === 1 ? '' : 's'}.
              </Alert>
              <Typography variant="body2">Point the charger at this address (OCPP 1.6J):</Typography>
              <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                {chargePointUrl(created.identity)}
              </Typography>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Typography variant="body2">Status:</Typography>
                {online ? (
                  <Chip size="small" color="success" label="Connected" />
                ) : (
                  <Chip size="small" variant="outlined" label="Waiting for the charger to connect…" />
                )}
              </Stack>
              {!online && (
                <Typography variant="body2" color="text.secondary">
                  The charge point is already saved. You can close this now and finish configuring the charger later;
                  it will show as Online here once it connects.
                </Typography>
              )}
              <ConnectionTest identity={created.identity} />
            </>
          )}
        </Stack>
        <Stack direction="row" sx={{ pt: 2, justifyContent: 'space-between' }}>
        {step < CONNECT_STEP ? (
          <>
            {onSwitchToForm ? (
              <Button onClick={onSwitchToForm} disabled={busy} color="inherit">
                Use the full form
              </Button>
            ) : (
              <span />
            )}
            <Stack direction="row" spacing={1}>
              <Button onClick={step === 0 ? onCancel : () => setStep((s) => s - 1)} disabled={busy}>
                {step === 0 ? cancelLabel : 'Back'}
              </Button>
              {step < REVIEW_STEP ? (
                <Button variant="contained" onClick={handleNext} disabled={busy}>
                  {busy ? 'Checking…' : 'Next'}
                </Button>
              ) : (
                <Button variant="contained" onClick={handleCreate} disabled={busy}>
                  {busy ? 'Saving…' : 'Save charge point'}
                </Button>
              )}
            </Stack>
          </>
        ) : (
          <>
            <span />
            <Button variant="contained" onClick={onFinish}>
              {online ? 'Done' : finishLabel}
            </Button>
          </>
        )}
        </Stack>
    </>
  );
}
