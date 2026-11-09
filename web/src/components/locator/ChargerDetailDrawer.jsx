import { useEffect, useState } from 'react';
import { Alert, Button, Chip, Divider, Drawer, IconButton, Stack, Table, TableBody, TableCell, TableRow, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { api } from '../../api/client.js';
import { StationNotices } from '../DriverNotices.jsx';
import {
  AMENITY_OPTIONS,
  CONNECTOR_STATUS_LABEL,
  PARKING_OPTIONS,
  STATE_INFO,
  formatKw,
  formatRate,
  joinTargetFor,
  labelsFor,
  standardName,
} from './locatorFormat.js';

const REFRESH_MS = 15000;

// Chips for a short list of labels, e.g. the amenities or parking a site offers.
function Chips({ labels }) {
  return (
    <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }}>
      {labels.map((label) => (
        <Chip key={label} size="small" variant="outlined" label={label} />
      ))}
    </Stack>
  );
}

// The site as a driver sees it: what is nearby, the parking, and whether it is access-controlled.
function AboutSite({ site }) {
  const features = site.features ?? { amenities: [], parking: [], accessControlled: false };
  const amenities = labelsFor(AMENITY_OPTIONS, features.amenities);
  const parking = labelsFor(PARKING_OPTIONS, features.parking);
  return (
    <Stack spacing={1.25}>
      <Typography variant="subtitle2">About {site.name}</Typography>
      {features.accessControlled && (
        <Alert severity="info">
          This site is access-controlled. Drivers need permission to use it, such as a workplace parking lot.
        </Alert>
      )}
      {amenities.length > 0 && (
        <>
          <Typography variant="body2" color="text.secondary">Nearby</Typography>
          <Chips labels={amenities} />
        </>
      )}
      {parking.length > 0 && (
        <>
          <Typography variant="body2" color="text.secondary">Parking at this site</Typography>
          <Chips labels={parking} />
        </>
      )}
      {!amenities.length && !parking.length && !features.accessControlled && (
        <Typography variant="body2" color="text.secondary">No details have been added for this site.</Typography>
      )}
    </Stack>
  );
}

// The charge point's detail: live connector status, power, price, hours and how to get there.
// It refreshes while open, so the connector states stay current. The button at the foot joins
// the waitlist, or starts charging when nobody is waiting and a charger is free.
export function ChargerDetailDrawer({ stationId, onClose, onJoin, lockedOut = false }) {
  const [station, setStation] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!stationId) return undefined;
    let cancelled = false;
    setStation(null);
    setError(null);
    const load = () =>
      api
        .get(`/api/locator/stations/${stationId}`)
        .then((res) => !cancelled && setStation(res.data))
        .catch(() => !cancelled && setError('This charge point could not be loaded.'));
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [stationId]);

  const open = Boolean(stationId);
  const state = station ? STATE_INFO[station.state] ?? STATE_INFO.OFFLINE : null;
  const target = station ? joinTargetFor(station) : null;
  const mapsLink = station
    ? `https://www.google.com/maps/dir/?api=1&destination=${station.latitude},${station.longitude}`
    : null;
  const osmLink = station ? `https://www.openstreetmap.org/?mlat=${station.latitude}&mlon=${station.longitude}#map=17/${station.latitude}/${station.longitude}` : null;

  return (
    <Drawer anchor="right" open={open} onClose={onClose} slotProps={{ paper: { sx: { width: { xs: '100%', sm: 420 }, p: 2.5 } } }}>
      <Stack direction="row" sx={{ alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
        <Typography variant="h6" sx={{ fontWeight: 600, pr: 1 }}>
          {station?.name ?? 'Charge point'}
        </Typography>
        <IconButton onClick={onClose} aria-label="Close">
          <CloseIcon />
        </IconButton>
      </Stack>

      {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      {!station && !error && (
        <Typography color="text.secondary" sx={{ mt: 2 }}>
          Loading…
        </Typography>
      )}

      {station && (
        <Stack spacing={2} sx={{ mt: 1.5 }}>
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
            <Chip label={state.label} sx={{ bgcolor: state.color, color: '#fff', fontWeight: 600 }} />
            <Chip variant="outlined" label={station.site.name} />
            {station.zone && <Chip variant="outlined" label={station.zone.name} />}
          </Stack>

          {station.address && (
            <Typography variant="body2">
              {[station.address, station.city, station.postalCode, station.country].filter(Boolean).join(', ')}
            </Typography>
          )}

          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
            <Button size="small" variant="outlined" href={mapsLink} target="_blank" rel="noopener">
              Directions
            </Button>
            <Button size="small" variant="text" href={osmLink} target="_blank" rel="noopener">
              View on OpenStreetMap
            </Button>
          </Stack>

          <StationNotices notices={station.notices} />

          <Divider />

          <Table size="small">
            <TableBody>
              <TableRow>
                <TableCell sx={{ pl: 0, color: 'text.secondary' }}>Price</TableCell>
                <TableCell>{formatRate(station.pricing)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell sx={{ pl: 0, color: 'text.secondary' }}>Hours</TableCell>
                <TableCell>{station.hours ?? 'Not given'}</TableCell>
              </TableRow>
              {station.amenities && (
                <TableRow>
                  <TableCell sx={{ pl: 0, color: 'text.secondary' }}>Nearby</TableCell>
                  <TableCell>{station.amenities}</TableCell>
                </TableRow>
              )}
              <TableRow>
                <TableCell sx={{ pl: 0, color: 'text.secondary' }}>Top power</TableCell>
                <TableCell>{formatKw(station.maxKw)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>

          {(station.parking ?? []).length > 0 && (
            <Stack spacing={1.25}>
              <Typography variant="subtitle2">Parking at this charge point</Typography>
              <Chips labels={labelsFor(PARKING_OPTIONS, station.parking)} />
            </Stack>
          )}

          <AboutSite site={station.site} />

          <Divider />

          <Typography variant="subtitle2">Connectors</Typography>
          <Stack spacing={1}>
            {station.connectors.map((c) => (
              <Stack key={c.connectorId} direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="body2">
                  {standardName(c.standard)}
                  {c.kw ? ` · ${c.kw} kW` : ''}
                </Typography>
                <Chip size="small" label={CONNECTOR_STATUS_LABEL[c.status] ?? 'Unknown'} variant="outlined" />
              </Stack>
            ))}
          </Stack>

          <Button variant="contained" disabled={lockedOut} onClick={() => onJoin(target)}>
            {target.mode === 'start' ? 'Start charging' : 'Join waitlist'}
          </Button>
          <Typography variant="caption" color="text.secondary">
            {target.waitingCount === 0
              ? 'No one is waiting.'
              : `${target.waitingCount} ${target.waitingCount === 1 ? 'person is' : 'people are'} waiting${station.zone ? ' for this zone' : ''}.`}{' '}
            Live status refreshes every 15 seconds.
          </Typography>
        </Stack>
      )}
    </Drawer>
  );
}
