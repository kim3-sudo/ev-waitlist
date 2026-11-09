import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Stack,
  Alert,
  Checkbox,
  FormControlLabel,
  ListSubheader,
  MenuItem,
  Paper,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useSettings } from '../context/SettingsContext.jsx';
import { sitePath } from '../sitePaths.js';
import { groupedRegions } from '../plateRegions.js';
import { PricingPanel } from './waitlist/PricingPanel.jsx';
import { HelpPanel } from './waitlist/HelpPanel.jsx';

// The form a driver fills in to join a waitlist, or to start charging when nobody is
// waiting (mode "start"). Two more tabs sit beside the form: Pricing (only when the site
// charges) and Help (tips for the charge point, and the site's contact details).
//
// target: { kind: 'station' | 'zone', id, name, tips: [{ stationName, text }], priceNotices }
// mode:   "join" | "start"
// onJoined receives { entryId, started?, error?, waiting? }. In start mode a driver who is
// offered a free charger is started straight away; `started` says that worked, `error` says it
// did not (the driver can then press Start on the status card), and `waiting` says no charger
// was free so they were put in line.
// What the contact field is for. Only a waitlist sends a message, so the text says so: when
// starting charging, the contact is used only if no charger is free and the driver is put in line.
function contactHelp({ starting, contactRequired, smsOffered }) {
  if (starting) {
    return contactRequired
      ? 'Only needed if no charger is free when you start. Then we can tell you here when one is ready.'
      : 'Optional. Only used if no charger is free when you start, so we can tell you here when one is ready.';
  }
  const how = smsOffered ? 'notify you' : 'e-mail you';
  return contactRequired ? `We'll ${how} here when a charger is ready.` : `Optional. We'll ${how} here when a charger is ready.`;
}

export function WaitlistJoinDialog({ target, mode = 'join', onClose, onJoined }) {
  const { settings } = useSettings();
  const identifierMode = settings.identifierMode ?? 'LICENSE_PLATE';
  const showPlate = identifierMode === 'LICENSE_PLATE' || identifierMode === 'BOTH';
  const showPermit = identifierMode === 'PARKING_PERMIT' || identifierMode === 'BOTH';
  const starting = mode === 'start';
  // A driver signed in on this site has their details filled in. A site may require one.
  const { can } = useAuth();
  const hasAccount = can('driver.account');
  const driverRequired = settings.driverAccounts === 'REQUIRED';
  const gated = driverRequired && !hasAccount;
  const contactRequired = settings.waitlistContactRequired !== false;

  const [tab, setTab] = useState('form');
  const [pricing, setPricing] = useState(null);

  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [licensePlate, setLicensePlate] = useState('');
  const [plateRegion, setPlateRegion] = useState(settings.defaultPlateRegion ?? '');
  const [parkingPermit, setParkingPermit] = useState('');
  // Text messages, when the site has them set up. The driver opts in and gives a mobile number.
  const smsOffered = Boolean(settings.smsAvailable);
  const [wantsSms, setWantsSms] = useState(false);
  const [smsNumber, setSmsNumber] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Roaming: when the site has it on, the warning must be read and accepted.
  const [roaming, setRoaming] = useState(null);
  const [warningAccepted, setWarningAccepted] = useState(false);

  // A signed-in driver's details fill the form. Anything they have typed is kept.
  useEffect(() => {
    if (!hasAccount) return;
    api
      .get('/api/driver/me')
      .then(({ data }) => {
        setName((value) => value || data.name || '');
        setContact((value) => value || data.email || '');
        setSmsNumber((value) => value || data.phone || '');
        const plate = data.vehicles.find((v) => v.licensePlate)?.licensePlate;
        if (plate) setLicensePlate((value) => value || plate);
      })
      .catch(() => {});
  }, [hasAccount]);

  useEffect(() => {
    api
      .get('/api/settings/roaming')
      .then(({ data }) => setRoaming(data))
      .catch(() => setRoaming({ enabled: false }));
    api
      .get('/api/pricing')
      .then(({ data }) => setPricing(data))
      .catch(() => setPricing({ enabled: false }));
  }, []);

  const roamingOn = Boolean(roaming?.enabled);
  const pricingOn = Boolean(pricing?.enabled);
  const contacts = settings.helpContacts;

  // Once the entry exists, a start-mode driver is started if a charger is free right now.
  async function startIfFree(entryId, status) {
    if (!starting) return { entryId };
    if (status !== 'NOTIFIED') return { entryId, waiting: true };
    try {
      await api.post(`/api/waitlist/${entryId}/start-charging`);
      return { entryId, started: true };
    } catch (err) {
      return { entryId, error: err.response?.data?.error ?? 'Could not start charging. Please try again.' };
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (identifierMode === 'BOTH' && !licensePlate.trim() && !parkingPermit.trim()) {
      setError('Enter a license plate number or a parking permit number.');
      return;
    }
    if (showPlate && licensePlate.trim() && !plateRegion) {
      setError('Choose the place where the plate was issued.');
      return;
    }

    setSubmitting(true);
    try {
      const path = target.kind === 'zone' ? `/api/zones/${target.id}/waitlist` : `/api/stations/${target.id}/waitlist`;
      const { data } = await api.post(path, {
        name,
        contact,
        licensePlate: showPlate ? licensePlate : undefined,
        plateRegion: showPlate ? plateRegion : undefined,
        parkingPermit: showPermit ? parkingPermit : undefined,
        smsNumber: smsOffered && wantsSms ? smsNumber : undefined,
        roamingWarningAccepted: roamingOn ? warningAccepted : undefined,
      });
      onJoined(await startIfFree(data.id, data.status));
    } catch (err) {
      setError(err.response?.data?.error ?? (starting ? 'Could not start charging. Please try again.' : 'Could not join the waitlist. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  }

  const actionLabel = starting ? 'Start charging' : 'Join waitlist';

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>
        {actionLabel} &mdash; {target.name}
      </DialogTitle>
      <Tabs value={tab} onChange={(_, value) => setTab(value)} variant="fullWidth" sx={{ px: 3, borderBottom: 1, borderColor: 'divider' }}>
        <Tab value="form" label={actionLabel} />
        {pricingOn && <Tab value="pricing" label="Pricing" />}
        <Tab value="help" label="Help" />
      </Tabs>
      <form onSubmit={handleSubmit}>
        <DialogContent>
          {tab === 'form' && gated && (
            <Stack spacing={2} sx={{ mt: 1 }}>
              <Alert severity="info">
                This site asks drivers to sign in before they join the waitlist or start charging.
              </Alert>
              <Button
                component={RouterLink}
                variant="contained"
                to={`${sitePath('/login')}?next=${encodeURIComponent(window.location.pathname + window.location.search)}`}
              >
                Sign in or create an account
              </Button>
            </Stack>
          )}

          {tab === 'form' && !gated && (
            <Stack spacing={2} sx={{ mt: 1 }}>
              {hasAccount && (
                <Typography variant="body2" color="text.secondary">
                  Signed in. Your details are filled in; you can change them here.
                </Typography>
              )}
              {starting && (
                <Typography variant="body2" color="text.secondary">
                  Nobody is waiting. If a charger is free, we'll unlock it for you as soon as you submit.
                </Typography>
              )}
              {error && <Alert severity="error">{error}</Alert>}
              <TextField
                label="Your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
                fullWidth
              />
              {/* Without text messages, the contact is an e-mail address only. */}
              <TextField
                label={smsOffered ? 'Email or phone' : 'Email'}
                type={smsOffered ? 'text' : 'email'}
                helperText={contactHelp({ starting, contactRequired, smsOffered })}
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                required={contactRequired}
                fullWidth
              />
              {smsOffered && (
                <Stack spacing={1}>
                  <FormControlLabel
                    control={<Checkbox checked={wantsSms} onChange={(e) => setWantsSms(e.target.checked)} />}
                    label="Also send me text messages"
                  />
                  {wantsSms && (
                    <TextField
                      label="Mobile number"
                      type="tel"
                      value={smsNumber}
                      onChange={(e) => setSmsNumber(e.target.value)}
                      helperText="Include the country code, for example +1 555 123 4567."
                      required
                      fullWidth
                    />
                  )}
                </Stack>
              )}
              {showPlate && (
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <TextField
                    select
                    label="Plate issued in"
                    value={plateRegion}
                    onChange={(e) => setPlateRegion(e.target.value)}
                    sx={{ minWidth: { sm: 180 } }}
                    required={identifierMode === 'LICENSE_PLATE'}
                  >
                    {groupedRegions(settings.plateRegions).map((group) => [
                      <ListSubheader key={`h-${group.name}`}>{group.name}</ListSubheader>,
                      ...group.items.map((r) => (
                        <MenuItem key={r.code} value={r.code}>
                          {r.name}
                        </MenuItem>
                      )),
                    ])}
                  </TextField>
                  <TextField
                    label="License plate number"
                    value={licensePlate}
                    onChange={(e) => setLicensePlate(e.target.value)}
                    required={identifierMode === 'LICENSE_PLATE'}
                    fullWidth
                  />
                </Stack>
              )}
              {showPermit && (
                <TextField
                  label="Parking permit number"
                  value={parkingPermit}
                  onChange={(e) => setParkingPermit(e.target.value)}
                  required={identifierMode === 'PARKING_PERMIT'}
                  fullWidth
                />
              )}
              {roamingOn && (
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Stack spacing={1}>
                    <Typography variant="subtitle2">Please read before joining</Typography>
                    <Typography variant="body2" sx={{ whiteSpace: 'pre-line' }}>
                      {roaming.warningText}
                    </Typography>
                    <FormControlLabel
                      control={
                        <Checkbox checked={warningAccepted} onChange={(e) => setWarningAccepted(e.target.checked)} required />
                      }
                      label="I have read and accept this warning"
                    />
                  </Stack>
                </Paper>
              )}
            </Stack>
          )}

          {tab === 'pricing' && pricingOn && <PricingPanel pricing={pricing} priceNotices={target.priceNotices} />}

          {tab === 'help' && <HelpPanel tips={target.tips} contacts={contacts} />}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose}>Cancel</Button>
          {tab === 'form' && (
            <Button type="submit" variant="contained" disabled={gated || submitting || (roamingOn && !warningAccepted)}>
              {submitting ? (starting ? 'Starting…' : 'Joining…') : actionLabel}
            </Button>
          )}
        </DialogActions>
      </form>
    </Dialog>
  );
}
