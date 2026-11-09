import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Chip,
  Container,
  Divider,
  FormControlLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

// Load balancing and smart charging: the site's supply, time-of-day schedules, and dynamic events
// (utility curtailment). Each section explains what it does and what it cannot do.

const PHASES = ['L1', 'L2', 'L3'];
const DAYS = [
  { value: 0, label: 'Sun' },
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
];

const blankPhases = () => ({ L1: '', L2: '', L3: '' });
const blankSchedule = () => ({ name: '', days: [1, 2, 3, 4, 5], start: '17:00', end: '21:00', limitAmps: '16', stationIds: [] });
const blankEvent = () => ({ name: '', startsAt: '', endsAt: '', phaseCapacityA: blankPhases() });

// The browser's clock, as the value a datetime-local input shows.
function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// The browser's clock to UTC. Events are entered in the browser's time zone, not the site's (see the warning).
function fromLocalInput(value) {
  if (!value) return '';
  return new Date(value).toISOString();
}

// Blank strings mean "not set". Returns null when all three phases are blank, and throws for a partial entry.
function parsePhases(p, label) {
  const values = PHASES.map((ph) => p[ph]);
  if (values.every((v) => v === '' || v == null)) return null;
  if (values.some((v) => v === '' || v == null)) throw new Error(`${label}: enter the amps for L1, L2 and L3, or leave all three blank.`);
  return Object.fromEntries(PHASES.map((ph) => [ph, Number(p[ph])]));
}

export function AdminLoadBalancingPage() {
  const { can } = useAuth();
  const canManage = can('stations.manage');
  const [state, setState] = useState(null);
  const [enabled, setEnabled] = useState(false);
  const [kw, setKw] = useState('');
  const [timeZone, setTimeZone] = useState('UTC');
  const [phases, setPhases] = useState(blankPhases);
  const [schedules, setSchedules] = useState([]);
  const [events, setEvents] = useState([]);
  const [stations, setStations] = useState([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  function take(data) {
    setState(data);
    setEnabled(data.enabled);
    setKw(data.siteCapacityKw ?? '');
    const c = data.smartCharging ?? {};
    setTimeZone(c.timeZone ?? 'UTC');
    setPhases(c.phaseCapacityA ? Object.fromEntries(PHASES.map((ph) => [ph, String(c.phaseCapacityA[ph])])) : blankPhases());
    setSchedules((c.schedules ?? []).map((s) => ({ ...s, limitAmps: String(s.limitAmps) })));
    setEvents(
      (c.events ?? []).map((e) => ({
        id: e.id,
        name: e.name,
        startsAt: toLocalInput(e.startsAt),
        endsAt: toLocalInput(e.endsAt),
        phaseCapacityA: Object.fromEntries(PHASES.map((ph) => [ph, String(e.phaseCapacityA[ph])])),
      })),
    );
  }

  useEffect(() => {
    api.get('/api/admin/load-balancing').then(({ data }) => take(data)).catch(() => setError('Load balancing could not be loaded.'));
    api.get('/api/admin/stations', { params: { limit: 200 } }).then(({ data }) => setStations(data.data ?? [])).catch(() => {});
  }, []);

  // Connectors on charge points with smart charging on, that have no phase wiring set.
  const unwired = useMemo(
    () =>
      stations
        .filter((s) => s.smartChargingEnabled)
        .flatMap((s) => (s.connectors ?? []).filter((c) => c.connectorId > 0 && c.phaseCount == null).map((c) => ({ station: s.name, connectorId: c.connectorId }))),
    [stations],
  );
  const smartStations = useMemo(() => stations.filter((s) => s.smartChargingEnabled), [stations]);

  // Which supply mode is in use, as the balancer will see it.
  const phaseSaved = state?.smartCharging?.phaseCapacityA != null;
  const mode = !enabled
    ? phaseSaved
      ? 'Load balancing is off. Schedules apply, but the per-phase supply is not used.'
      : 'Load balancing is off. Only schedules apply.'
    : phaseSaved
      ? 'The per-phase supply is in use. The total kW is ignored.'
      : 'The total kW supply is in use.';

  async function saveSupply(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      const { data } = await api.put('/api/admin/load-balancing', { enabled, siteCapacityKw: kw === '' ? null : Number(kw) });
      take(data);
      setMessage('Supply saved. The charge points are balanced again now.');
    } catch (err) {
      setError(err.response?.data?.error ?? 'The supply could not be saved.');
    }
  }

  async function saveConfig() {
    setError('');
    setMessage('');
    let payload;
    try {
      const phaseCapacityA = parsePhases(phases, 'Supply per phase');
      const eventList = events.map((ev) => {
        const label = `Event "${ev.name || 'unnamed'}"`;
        const capacity = parsePhases(ev.phaseCapacityA, label);
        if (!capacity) throw new Error(`${label} needs a capacity for L1, L2 and L3.`);
        return { id: ev.id, name: ev.name, startsAt: fromLocalInput(ev.startsAt), endsAt: fromLocalInput(ev.endsAt), phaseCapacityA: capacity };
      });
      if (eventList.length && !phaseCapacityA) {
        throw new Error('Events need the supply per phase. Enter L1, L2 and L3 above, then save again.');
      }
      payload = {
        timeZone,
        phaseCapacityA,
        schedules: schedules.map((s) => ({ ...s, limitAmps: Number(s.limitAmps) })),
        events: eventList,
      };
    } catch (err) {
      setError(err.message);
      return;
    }
    try {
      const { data } = await api.put('/api/admin/load-balancing/config', payload);
      take(data);
      setMessage('Schedules and events saved. The charge points are updated now.');
    } catch (err) {
      setError(err.response?.data?.error ?? 'The schedules and events could not be saved.');
    }
  }

  async function runNow() {
    setError('');
    setMessage('');
    try {
      const { data } = await api.post('/api/admin/load-balancing/run');
      if (data.skipped) setMessage(data.skipped);
      else
        setMessage(
          `Sent ${data.sent} limit(s).${data.overCapacity ? ' The supply cannot give every charging connector the minimum current. Raise the supply or reduce the chargers.' : ''}${data.skippedOffline ? ` ${data.skippedOffline} connector(s) were offline and will be set when they reconnect.` : ''}`,
        );
    } catch (err) {
      setError(err.response?.data?.error ?? 'The balance could not be run.');
    }
  }

  // Helpers that change one row of a list.
  const patchRow = (setter, i, field, value) => setter((rows) => rows.map((r, j) => (j === i ? { ...r, [field]: value } : r)));
  const removeRow = (setter, i) => setter((rows) => rows.filter((_, j) => j !== i));

  return (
    <Container maxWidth="md" sx={{ py: 3 }}>
      <Stack spacing={3}>
        <Typography variant="h5" fontWeight={600}>Load balancing and smart charging</Typography>
        {message && <Alert severity="success" onClose={() => setMessage('')}>{message}</Alert>}
        {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}

        {/* Supply */}
        <Paper sx={{ p: 2 }} component="form" onSubmit={saveSupply}>
          <Stack spacing={2}>
            <Typography variant="h6">Site supply</Typography>
            <Typography variant="body2" color="text.secondary">
              Turn this on when the site's electrical supply cannot run every charge point at full power at once. Charge
              points with smart charging on share the supply while they charge. A manual limit set on a charge point is a
              ceiling while this is on: the balance never goes above it.
            </Typography>
            <FormControlLabel
              control={<Checkbox checked={enabled} disabled={!canManage} onChange={(e) => setEnabled(e.target.checked)} />}
              label="Share the site supply between charging connectors"
            />
            <TextField
              label="Total supply (kW)"
              type="number"
              value={kw}
              disabled={!canManage}
              onChange={(e) => setKw(e.target.value)}
              slotProps={{ htmlInput: { min: 0, step: 'any' } }}
              helperText="Used when no supply per phase is set below. The total the site can supply to its chargers."
              sx={{ maxWidth: 320 }}
            />
            <Alert severity="info">{mode}</Alert>
            {state?.chargePointsWithSmartCharging !== undefined && (
              <Typography variant="body2" color="text.secondary">
                {state.chargePointsWithSmartCharging} charge point(s) have smart charging on.
              </Typography>
            )}
            {canManage && (
              <Stack direction="row" spacing={2}>
                <Button type="submit" variant="contained">Save supply</Button>
                <Button variant="outlined" onClick={runNow}>Balance now</Button>
              </Stack>
            )}
          </Stack>
        </Paper>

        {/* Phase supply and wiring */}
        <Paper sx={{ p: 2 }}>
          <Stack spacing={2}>
            <Typography variant="h6">Supply per phase</Typography>
            <Typography variant="body2" color="text.secondary">
              Enter the amps each phase of the supply can carry. With these set, each connector draws on the phases it is
              wired to, and no phase is loaded above its amps. Leave all three blank to use the total kW instead.
            </Typography>
            {unwired.length > 0 && (
              <Alert severity="warning">
                <Typography variant="body2" fontWeight={600}>
                  {unwired.length} connector(s) have no phase wiring set.
                </Typography>
                <Typography variant="body2">
                  Until each one is set to single-phase or three-phase, load balancing counts it on all three phases. A
                  single-phase connector then takes capacity from phases it does not use, so the site's usable capacity may
                  be under-reported and other chargers may be given less than they could have. Set the wiring on each
                  charge point's connector details.
                </Typography>
                <Typography variant="body2" sx={{ mt: 1 }}>
                  {unwired.map((u) => `${u.station}, connector ${u.connectorId}`).join(' · ')}
                </Typography>
              </Alert>
            )}
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              {PHASES.map((ph) => (
                <TextField
                  key={ph}
                  label={`${ph} (amps)`}
                  type="number"
                  value={phases[ph]}
                  disabled={!canManage}
                  onChange={(e) => setPhases((p) => ({ ...p, [ph]: e.target.value }))}
                  slotProps={{ htmlInput: { min: 0, step: 'any' } }}
                  fullWidth
                />
              ))}
            </Stack>
            <TextField
              label="Site time zone"
              value={timeZone}
              disabled={!canManage}
              onChange={(e) => setTimeZone(e.target.value)}
              helperText="An IANA name such as Europe/London. Schedules use this zone's clock."
              sx={{ maxWidth: 320 }}
            />
          </Stack>
        </Paper>

        {/* Schedules */}
        <Paper sx={{ p: 2 }}>
          <Stack spacing={2}>
            <Typography variant="h6">Time-of-day schedules</Typography>
            <Alert severity="info">
              A schedule caps the charge points it covers during its window, for example 16 A from 17:00 to 21:00 on weekdays.
              Where windows overlap, the lowest limit applies. A schedule is a ceiling: it can lower a limit but never raise
              one. A manual limit set on a charge point is also a ceiling, so while a schedule runs, the lower of the two
              applies. They work even when load balancing is off. The end time is not included, and a window that ends
              before it starts runs overnight.
            </Alert>
            {state?.ceilingWarnings?.length > 0 && (
              <Alert severity="warning">
                <Typography variant="body2" fontWeight={600}>
                  {state.ceilingWarnings.length} manual limit(s) are held down by a schedule right now.
                </Typography>
                {state.ceilingWarnings.map((w) => (
                  <Typography key={`${w.stationId}-${w.connectorId}`} variant="body2">
                    {w.station}, connector {w.connectorId}: {w.message}
                  </Typography>
                ))}
              </Alert>
            )}
            {schedules.map((s, i) => (
              <Paper key={s.id ?? `new-${i}`} variant="outlined" sx={{ p: 2 }}>
                <Stack spacing={1.5}>
                  <Stack direction="row" spacing={1.5} alignItems="center">
                    <TextField
                      label="Name"
                      size="small"
                      value={s.name}
                      disabled={!canManage}
                      onChange={(e) => patchRow(setSchedules, i, 'name', e.target.value)}
                      fullWidth
                    />
                    {canManage && (
                      <Button color="error" onClick={() => removeRow(setSchedules, i)}>Remove</Button>
                    )}
                  </Stack>
                  <ToggleButtonGroup
                    size="small"
                    value={s.days}
                    disabled={!canManage}
                    onChange={(_e, v) => patchRow(setSchedules, i, 'days', v)}
                    aria-label="Days"
                  >
                    {DAYS.map((d) => (
                      <ToggleButton key={d.value} value={d.value}>{d.label}</ToggleButton>
                    ))}
                  </ToggleButtonGroup>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                    <TextField
                      label="From"
                      type="time"
                      size="small"
                      value={s.start}
                      disabled={!canManage}
                      onChange={(e) => patchRow(setSchedules, i, 'start', e.target.value)}
                      slotProps={{ inputLabel: { shrink: true } }}
                    />
                    <TextField
                      label="Until (not included)"
                      type="time"
                      size="small"
                      value={s.end}
                      disabled={!canManage}
                      onChange={(e) => patchRow(setSchedules, i, 'end', e.target.value)}
                      slotProps={{ inputLabel: { shrink: true } }}
                    />
                    <TextField
                      label="Limit (amps)"
                      type="number"
                      size="small"
                      value={s.limitAmps}
                      disabled={!canManage}
                      onChange={(e) => patchRow(setSchedules, i, 'limitAmps', e.target.value)}
                      slotProps={{ htmlInput: { min: 6, max: 80 } }}
                    />
                  </Stack>
                  <Select
                    size="small"
                    multiple
                    displayEmpty
                    disabled={!canManage}
                    value={s.stationIds}
                    onChange={(e) => patchRow(setSchedules, i, 'stationIds', e.target.value)}
                    renderValue={(sel) =>
                      sel.length === 0
                        ? 'All charge points'
                        : sel.map((id) => smartStations.find((st) => st.id === id)?.name ?? id).join(', ')
                    }
                  >
                    {smartStations.map((st) => (
                      <MenuItem key={st.id} value={st.id}>{st.name}</MenuItem>
                    ))}
                  </Select>
                  <Typography variant="caption" color="text.secondary">
                    Charge points covered. Leave empty for every charge point with smart charging on.
                  </Typography>
                </Stack>
              </Paper>
            ))}
            {canManage && (
              <Button
                variant="outlined"
                onClick={() => setSchedules((rows) => [...rows, blankSchedule()])}
                sx={{ alignSelf: 'flex-start' }}
              >
                Add schedule
              </Button>
            )}
          </Stack>
        </Paper>

        {/* Events */}
        <Paper sx={{ p: 2 }}>
          <Stack spacing={2}>
            <Typography variant="h6">Dynamic events (curtailment)</Typography>
            <Alert severity="warning">
              <Typography variant="body2" fontWeight={600}>Events need a supply per phase.</Typography>
              <Typography variant="body2">
                An event sets a limit for L1, L2 and L3 separately, so it can only be used when the supply is set per phase
                above. A site that has only a total kW supply cannot use events. Limitations to know before you rely on one:
              </Typography>
              <Typography component="ul" variant="body2" sx={{ pl: 2, mb: 0 }}>
                <li>An event is applied within about a minute of its start and end, not at the exact second.</li>
                <li>It limits only charge points with smart charging on, and only while they have a limit to change.</li>
                <li>A charge point that is offline gets the limit when it reconnects.</li>
                <li>Times are entered in this browser's time zone. Check them against the site's clock before you save.</li>
                <li>Events are not recorded for reporting, so an event does not produce a performance record.</li>
                <li>To end an event early, change its end time. Deleting it also releases the limit.</li>
              </Typography>
            </Alert>
            {events.map((ev, i) => (
              <Paper key={ev.id ?? `new-${i}`} variant="outlined" sx={{ p: 2 }}>
                <Stack spacing={1.5}>
                  <Stack direction="row" spacing={1.5} alignItems="center">
                    <TextField
                      label="Name"
                      size="small"
                      value={ev.name}
                      disabled={!canManage}
                      onChange={(e) => patchRow(setEvents, i, 'name', e.target.value)}
                      fullWidth
                    />
                    {canManage && <Button color="error" onClick={() => removeRow(setEvents, i)}>Remove</Button>}
                  </Stack>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                    <TextField
                      label="Starts"
                      type="datetime-local"
                      size="small"
                      value={ev.startsAt}
                      disabled={!canManage}
                      onChange={(e) => patchRow(setEvents, i, 'startsAt', e.target.value)}
                      slotProps={{ inputLabel: { shrink: true } }}
                    />
                    <TextField
                      label="Ends"
                      type="datetime-local"
                      size="small"
                      value={ev.endsAt}
                      disabled={!canManage}
                      onChange={(e) => patchRow(setEvents, i, 'endsAt', e.target.value)}
                      slotProps={{ inputLabel: { shrink: true } }}
                    />
                  </Stack>
                  <Stack direction="row" spacing={1.5}>
                    {PHASES.map((ph) => (
                      <TextField
                        key={ph}
                        label={`${ph} capacity (A)`}
                        type="number"
                        size="small"
                        value={ev.phaseCapacityA[ph]}
                        disabled={!canManage}
                        onChange={(e) =>
                          setEvents((rows) =>
                            rows.map((r, j) => (j === i ? { ...r, phaseCapacityA: { ...r.phaseCapacityA, [ph]: e.target.value } } : r)),
                          )
                        }
                        slotProps={{ htmlInput: { min: 0, step: 'any' } }}
                        fullWidth
                      />
                    ))}
                  </Stack>
                </Stack>
              </Paper>
            ))}
            {canManage && (
              <Button variant="outlined" onClick={() => setEvents((rows) => [...rows, blankEvent()])} sx={{ alignSelf: 'flex-start' }}>
                Add event
              </Button>
            )}
          </Stack>
        </Paper>

        {canManage && (
          <>
            <Divider />
            <Stack direction="row" spacing={2} alignItems="center">
              <Button variant="contained" onClick={saveConfig}>Save schedules and events</Button>
              {state?.smartCharging?.schedules?.length > 0 && (
                <Chip size="small" label={`${state.smartCharging.schedules.length} schedule(s) saved`} />
              )}
              {state?.smartCharging?.events?.length > 0 && (
                <Chip size="small" label={`${state.smartCharging.events.length} event(s) saved`} />
              )}
            </Stack>
          </>
        )}
      </Stack>
    </Container>
  );
}
