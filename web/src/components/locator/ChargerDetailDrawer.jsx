import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert,
  Button,
  Chip,
  Divider,
  Drawer,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableRow,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { api } from '../../api/client.js';
import {
  CONNECTOR_STATUS_LABEL,
  STATE_INFO,
  formatKw,
  formatRate,
  sitePagePath,
  standardName,
} from './locatorFormat.js';

const REFRESH_MS = 15000;

// The charge point's detail: live connector status, power, price, hours and how to get there.
// It refreshes while open, so the connector states stay current.
export function ChargerDetailDrawer({ stationId, onClose }) {
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

          {station.notices?.alerts?.map((a) => (
            <Alert key={a.id} severity={a.severity === 'WARNING' ? 'warning' : 'info'}>
              {a.message}
            </Alert>
          ))}

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

          <Divider />

          <Button component={RouterLink} to={sitePagePath(station.site)} variant="contained">
            {station.zone ? 'Join the zone waitlist' : 'Join the waitlist'}
          </Button>
          <Typography variant="caption" color="text.secondary">
            Live status refreshes every 15 seconds.
          </Typography>
        </Stack>
      )}
    </Drawer>
  );
}
