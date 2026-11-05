import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import {
  Alert,
  Avatar,
  Button,
  Container,
  MenuItem,
  Paper,
  Stack,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography,
} from '@mui/material';
import { api } from '../api/client.js';
import { useSettings } from '../context/SettingsContext.jsx';
import { ChargePointWizard } from '../components/ChargePointWizardDialog.jsx';

const STEPS = ['Add a charge point', 'Set up branding', 'Finish'];

const IDENTIFIER_OPTIONS = [
  { value: 'LICENSE_PLATE', label: 'License plate number only' },
  { value: 'PARKING_PERMIT', label: 'Parking permit number only' },
  { value: 'BOTH', label: 'Either license plate or parking permit' },
];

const MAX_LOGO_BYTES = 500 * 1024;

function ChargePointStep({ onNext, onSkip }) {
  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        Add your first charge point now, or skip and add charge points later from the stations page.
      </Typography>
      <ChargePointWizard onCancel={onSkip} onFinish={onNext} cancelLabel="Skip" finishLabel="Continue" />
    </Stack>
  );
}

function BrandingStep({ onBack, onSkip, onSaved }) {
  const { settings } = useSettings();
  const [form, setForm] = useState(() => ({
    companyName: settings.companyName ?? '',
    logoUrl: settings.logoUrl ?? '',
    primaryColor: settings.primaryColor ?? '#0d7a5f',
    secondaryColor: settings.secondaryColor ?? '#1565c0',
    identifierMode: settings.identifierMode ?? 'LICENSE_PLATE',
  }));
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

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

  async function handleSave(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await api.put('/api/admin/settings', { ...form, logoUrl: form.logoUrl || null });
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not save branding.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Stack component="form" onSubmit={handleSave} spacing={2}>
      <Typography variant="body2" color="text.secondary">
        This is what drivers see on the public waitlist page.
      </Typography>
      {error && <Alert severity="error">{error}</Alert>}
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
      <TextField
        select
        label="Join form asks for"
        value={form.identifierMode}
        onChange={update('identifierMode')}
        fullWidth
      >
        {IDENTIFIER_OPTIONS.map((opt) => (
          <MenuItem key={opt.value} value={opt.value}>
            {opt.label}
          </MenuItem>
        ))}
      </TextField>
      <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between' }}>
        <Button onClick={onBack}>Back</Button>
        <Stack direction="row" spacing={1}>
          <Button onClick={onSkip}>Skip</Button>
          <Button type="submit" variant="contained" disabled={submitting}>
            {submitting ? 'Saving…' : 'Save and continue'}
          </Button>
        </Stack>
      </Stack>
    </Stack>
  );
}

function FinishStep({ onBack, onFinish, finishing, error }) {
  return (
    <Stack spacing={2}>
      <Typography variant="body2">
        Setup is ready. You can change any of this later from the admin pages.
      </Typography>
      {error && <Alert severity="error">{error}</Alert>}
      <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between' }}>
        <Button onClick={onBack}>Back</Button>
        <Button variant="contained" onClick={onFinish} disabled={finishing}>
          {finishing ? 'Finishing…' : 'Go to admin'}
        </Button>
      </Stack>
    </Stack>
  );
}

export function SetupWizardPage() {
  const { loaded, settings, refresh } = useSettings();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState('');

  if (!loaded) return null;
  // Already set up (or the flag was cleared elsewhere): nothing to do here.
  if (settings.setupCompleted) return <Navigate to="/admin" replace />;

  async function handleFinish() {
    setError('');
    setFinishing(true);
    try {
      await api.post('/api/admin/setup/complete');
      await refresh();
      navigate('/admin', { replace: true });
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not finish setup.');
    } finally {
      setFinishing(false);
    }
  }

  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Typography variant="h5" fontWeight={600} gutterBottom>
        Welcome. Let's get you set up.
      </Typography>
      <Paper variant="outlined" sx={{ p: 3, mt: 2 }}>
        <Stepper activeStep={step} sx={{ mb: 3 }}>
          {STEPS.map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>

        {step === 0 && <ChargePointStep onNext={next} onSkip={next} />}
        {step === 1 && <BrandingStep onBack={back} onSkip={next} onSaved={next} />}
        {step === 2 && (
          <FinishStep onBack={back} onFinish={handleFinish} finishing={finishing} error={error} />
        )}
      </Paper>
    </Container>
  );
}
