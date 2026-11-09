import { useEffect, useState } from 'react';
import { Alert, Box, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircle';
import BoltIcon from '@mui/icons-material/Bolt';
import ErrorOutlineIcon from '@mui/icons-material/Error';
import BuildOutlinedIcon from '@mui/icons-material/BuildOutlined';
import CloudOffIcon from '@mui/icons-material/CloudOff';
import EventSeatIcon from '@mui/icons-material/EventSeat';
import { api } from '../../api/client.js';
import {
  Donut,
  DailyColumns,
  Legend,
  PercentBars,
  Panel,
  SegmentedBar,
  StatTile,
  percentText,
  useChartColors,
} from './charts.jsx';

const REFRESH_MS = 30_000;
const RANGES = [
  { value: 1, label: '24 hours' },
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
];

// Connector states. Each has an icon and a text label, so color is never the only cue.
function useConnectorStates() {
  const c = useChartColors();
  return [
    { key: 'available', label: 'Available', color: c.good, icon: <CheckCircleOutlineIcon fontSize="small" /> },
    { key: 'inUse', label: 'In use', color: c.blue, icon: <BoltIcon fontSize="small" /> },
    { key: 'reserved', label: 'Reserved', color: c.violet, icon: <EventSeatIcon fontSize="small" /> },
    { key: 'error', label: 'Error', color: c.critical, icon: <ErrorOutlineIcon fontSize="small" /> },
    { key: 'maintenance', label: 'Maintenance', color: c.warning, icon: <BuildOutlinedIcon fontSize="small" /> },
    { key: 'offline', label: 'Offline', color: c.muted, icon: <CloudOffIcon fontSize="small" /> },
  ];
}

function formatMoney(cents, currency) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD' }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency ?? ''}`.trim();
  }
}

function formatDateTime(value) {
  return value ? new Date(value).toLocaleString() : '—';
}

function ConnectorStatus({ connectors }) {
  const states = useConnectorStates();
  const c = useChartColors();
  const segments = states.map((s) => ({ label: s.label, value: connectors[s.key] ?? 0, color: s.color }));
  return (
    <Panel title="Connector status" subtitle={`${connectors.total} connectors right now`}>
      <SegmentedBar segments={segments} height={22} />
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 1.5, mt: 2 }}>
        {states.map((s) => (
          <Stack key={s.key} direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
            <Box aria-hidden sx={{ color: s.color, display: 'flex' }}>
              {s.icon}
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="h6" fontWeight={600} sx={{ lineHeight: 1.1 }}>
                {connectors[s.key] ?? 0}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap>
                {s.label}
              </Typography>
            </Box>
          </Stack>
        ))}
      </Box>
      <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1.5, color: c.secondary }}>
        Total {connectors.total}. Each connector counts once. Connectors on a station that is offline count as offline.
      </Typography>
    </Panel>
  );
}

function Connectivity({ connectivity }) {
  const c = useChartColors();
  const { total, online, offline, stations } = connectivity;
  const offlineStations = stations.filter((s) => !s.online);
  return (
    <Panel title="Station connectivity" subtitle="Live: stations connected to the server now">
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: 'center' }}>
        <Donut
          parts={[
            { label: 'Online', value: online, color: c.good },
            { label: 'Offline', value: offline, color: c.critical },
          ]}
          center={
            <>
              <Typography variant="h5" fontWeight={600} sx={{ lineHeight: 1 }}>
                {total ? Math.round((online / total) * 100) : 0}%
              </Typography>
              <Typography variant="caption" color="text.secondary">
                online
              </Typography>
            </>
          }
        />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Legend
            items={[
              { label: 'Online', value: online, color: c.good },
              { label: 'Offline', value: offline, color: c.critical },
            ]}
          />
          {offlineStations.length > 0 && (
            <Box sx={{ mt: 1.5 }}>
              <Typography variant="body2" fontWeight={600}>
                Offline now
              </Typography>
              <Stack component="ul" sx={{ listStyle: 'none', p: 0, m: 0, mt: 0.5 }} spacing={0.5}>
                {offlineStations.slice(0, 6).map((s) => (
                  <Typography component="li" key={s.stationId} variant="caption" color="text.secondary">
                    {s.stationName} · last seen {formatDateTime(s.lastSeenAt)}
                  </Typography>
                ))}
                {offlineStations.length > 6 && (
                  <Typography component="li" variant="caption" color="text.secondary">
                    and {offlineStations.length - 6} more on the Charge points tab
                  </Typography>
                )}
              </Stack>
            </Box>
          )}
        </Box>
      </Stack>
    </Panel>
  );
}

function Uptime({ uptime, days }) {
  const c = useChartColors();
  const rows = uptime.stations.map((s) => ({ id: s.stationId, name: s.stationName, value: s.uptimePercent }));
  return (
    <Panel
      title="Station uptime"
      subtitle={`Share of the last ${days === 1 ? '24 hours' : `${days} days`} each station was connected. Disconnects shorter than 2 minutes do not count.`}
    >
      <Typography variant="h5" fontWeight={600}>
        {percentText(uptime.overallPercent)}
      </Typography>
      <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1.5 }}>
        Average across stations
      </Typography>
      <PercentBars rows={rows} color={c.good} />
    </Panel>
  );
}

function Utilization({ utilization, days }) {
  const c = useChartColors();
  const { chargingPercent, waitingPercent, freePercent, stations } = utilization;
  const series = [
    { label: 'Charging', value: chargingPercent, color: c.blue },
    { label: 'Idle after charging', value: waitingPercent, color: c.orange },
    { label: 'Free', value: freePercent, color: c.neutral },
  ];
  const stationRows = stations.map((s) => ({ id: s.stationId, name: s.stationName, value: s.chargingPercent }));
  return (
    <Panel
      title="Utilization and idle time"
      subtitle={`Share of connector time in the last ${days === 1 ? '24 hours' : `${days} days`}. Idle means a car stayed plugged in after charging finished.`}
    >
      <SegmentedBar segments={series} height={22} />
      <Legend items={series.map((s) => ({ label: s.label, value: percentText(s.value), color: s.color }))} />
      <Typography variant="body2" fontWeight={600} sx={{ mt: 2, mb: 1 }}>
        Charging time by station
      </Typography>
      <PercentBars rows={stationRows} color={c.blue} emptyText="No stations yet." />
    </Panel>
  );
}

function Money({ money, days }) {
  const c = useChartColors();
  if (!money) return null;
  if (!money.configured) {
    return (
      <Panel title="Money" subtitle="Pricing is not configured yet.">
        <Typography variant="body2" color="text.secondary">
          Set a rate under Payment settings to see revenue here.
        </Typography>
      </Panel>
    );
  }
  const fmt = (cents) => formatMoney(cents, money.currency);
  const daily = money.daily.map((d) => ({ label: d.day, value: d.revenueCents }));
  return (
    <Panel title="Money" subtitle={`Paid charges in the last ${days === 1 ? '24 hours' : `${days} days`}, by the day they were paid.`}>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 1.5, mb: 2 }}>
        <StatTile label="Revenue" value={fmt(money.revenueCents)} detail={`${money.paidCount} paid charges`} />
        <StatTile
          label="Average charge"
          value={money.averageChargeCents == null ? '—' : fmt(money.averageChargeCents)}
          detail="Per paid charge"
        />
        <StatTile label="Owed, not yet paid" value={fmt(money.outstandingCents)} detail={`${money.pendingCount} pending`} />
        <StatTile label="Needs review" value={money.needsReviewCount} detail="Charges to check before billing" />
      </Box>
      <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>
        Revenue per day
      </Typography>
      <DailyColumns data={daily} format={fmt} />
      <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1, color: c.secondary }}>
        Pricing model: {money.pricingModel}
      </Typography>
    </Panel>
  );
}

export function DashboardView() {
  const [days, setDays] = useState(7);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const { data: body } = await api.get('/api/admin/dashboard', { params: { days } });
        if (!cancelled) {
          setData(body);
          setError(null);
        }
      } catch {
        if (!cancelled) setError('The dashboard could not be loaded. It will try again shortly.');
      }
    }
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [days]);

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}>
        <Box>
          <Typography variant="h5" fontWeight={600}>
            Dashboard
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {data ? `Updated ${new Date(data.generatedAt).toLocaleTimeString()} · refreshes every 30 seconds` : 'Loading…'}
          </Typography>
        </Box>
        <ToggleButtonGroup exclusive size="small" value={days} onChange={(_, next) => next && setDays(next)} aria-label="Time range">
          {RANGES.map((r) => (
            <ToggleButton key={r.value} value={r.value}>
              {r.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Stack>

      {error && <Alert severity="warning">{error}</Alert>}

      {data && (
        <>
          <ConnectorStatus connectors={data.connectors} />
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
            <Connectivity connectivity={data.connectivity} />
            <Uptime uptime={data.uptime} days={days} />
          </Box>
          <Utilization utilization={data.utilization} days={days} />
          {data.money !== undefined && <Money money={data.money} days={days} />}
        </>
      )}
    </Stack>
  );
}
