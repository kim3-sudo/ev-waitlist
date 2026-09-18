import { useEffect, useState } from 'react';
import {
  Container,
  Grid,
  Card,
  CardContent,
  CardActions,
  Typography,
  Chip,
  Button,
  Stack,
  Box,
  Tooltip,
} from '@mui/material';
import BoltIcon from '@mui/icons-material/Bolt';
import { api } from '../api/client.js';
import { WaitlistJoinDialog } from '../components/WaitlistJoinDialog.jsx';
import { WaitlistStatusCard } from '../components/WaitlistStatusCard.jsx';
import { ocppStatusLabel, ocppStatusDescription } from '../ocppStatus.js';

const STATIONS_POLL_MS = 8000;
const MY_ENTRIES_KEY = 'myWaitlistEntries';

const CONNECTOR_COLOR = {
  Available: 'success',
  Preparing: 'info',
  Charging: 'info',
  SuspendedEVSE: 'warning',
  SuspendedEV: 'warning',
  Finishing: 'info',
  Reserved: 'secondary',
  Unavailable: 'default',
  Faulted: 'error',
};

function loadMyEntries() {
  try {
    return JSON.parse(localStorage.getItem(MY_ENTRIES_KEY)) ?? [];
  } catch {
    return [];
  }
}

function saveMyEntries(entries) {
  localStorage.setItem(MY_ENTRIES_KEY, JSON.stringify(entries));
}

export function PublicWaitlistPage() {
  const [stations, setStations] = useState([]);
  const [zones, setZones] = useState([]);
  const [joinTarget, setJoinTarget] = useState(null);
  const [myEntries, setMyEntries] = useState(loadMyEntries);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const [stationsRes, zonesRes] = await Promise.all([api.get('/api/stations'), api.get('/api/zones')]);
        if (!cancelled) {
          setStations(stationsRes.data);
          setZones(zonesRes.data);
        }
      } catch {
        // list will simply not refresh this cycle
      }
    }

    poll();
    const id = setInterval(poll, STATIONS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  function handleJoined({ entryId }) {
    const next = [...myEntries, entryId];
    setMyEntries(next);
    saveMyEntries(next);
    setJoinTarget(null);
  }

  function handleLeave(entryId) {
    const next = myEntries.filter((id) => id !== entryId);
    setMyEntries(next);
    saveMyEntries(next);
  }

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      {myEntries.length > 0 && (
        <Box sx={{ mb: 4 }}>
          <Typography variant="h6" gutterBottom>
            Your waitlist status
          </Typography>
          {myEntries.map((entryId) => (
            <WaitlistStatusCard key={entryId} entryId={entryId} onLeave={handleLeave} />
          ))}
        </Box>
      )}

      <Typography variant="h5" fontWeight={600} gutterBottom>
        Charging stations
      </Typography>

      <Grid container spacing={2} sx={{ mt: 0.5 }}>
        {zones.map((zone) => (
          <Grid key={zone.id} size={{ xs: 12, sm: 6 }}>
            <Card variant="outlined" sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
              <CardContent sx={{ flexGrow: 1 }}>
                <Typography variant="h6">{zone.name}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {zone.stations.length} {zone.stations.length === 1 ? 'charger' : 'chargers'} in this zone
                </Typography>

                <Stack spacing={1} sx={{ mt: 2 }}>
                  {zone.stations.map((station) => (
                    <Stack key={station.id} direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                      <BoltIcon color={station.online ? 'primary' : 'disabled'} fontSize="small" />
                      <Typography variant="body2">{station.name}</Typography>
                      {station.connectors.map((c) => (
                        <Tooltip key={c.connectorId} title={ocppStatusDescription(c.status, 'driver') ?? ''} arrow>
                          <Chip
                            size="small"
                            label={`#${c.connectorId} ${ocppStatusLabel(c.status)}`}
                            color={CONNECTOR_COLOR[c.status] ?? 'default'}
                          />
                        </Tooltip>
                      ))}
                      {!station.online && <Chip size="small" label="Offline" variant="outlined" />}
                    </Stack>
                  ))}
                  {zone.stations.length === 0 && (
                    <Typography variant="body2" color="text.secondary">
                      No chargers assigned yet
                    </Typography>
                  )}
                </Stack>

                <Typography variant="body2" sx={{ mt: 2 }} color="text.secondary">
                  {zone.waitingCount === 0
                    ? 'No one waiting'
                    : `${zone.waitingCount} ${zone.waitingCount === 1 ? 'person' : 'people'} waiting`}
                </Typography>
              </CardContent>
              <CardActions sx={{ px: 2, pb: 2 }}>
                <Button
                  variant="contained"
                  fullWidth
                  disabled={zone.stations.length === 0}
                  onClick={() => setJoinTarget({ kind: 'zone', id: zone.id, name: zone.name })}
                >
                  Join waitlist
                </Button>
              </CardActions>
            </Card>
          </Grid>
        ))}

        {stations.map((station) => (
          <Grid key={station.id} size={{ xs: 12, sm: 6 }}>
            <Card variant="outlined" sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
              <CardContent sx={{ flexGrow: 1 }}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <BoltIcon color={station.online ? 'primary' : 'disabled'} fontSize="small" />
                  <Typography variant="h6">{station.name}</Typography>
                </Stack>
                {station.location && (
                  <Typography variant="body2" color="text.secondary">
                    {station.location}
                  </Typography>
                )}

                <Stack direction="row" spacing={1} useFlexGap sx={{ mt: 2, flexWrap: 'wrap' }}>
                  {station.connectors.length === 0 && (
                    <Typography variant="body2" color="text.secondary">
                      No connectors configured
                    </Typography>
                  )}
                  {station.connectors.map((c) => (
                    <Tooltip key={c.connectorId} title={ocppStatusDescription(c.status, 'driver') ?? ''} arrow>
                      <Chip
                        size="small"
                        label={`#${c.connectorId} ${ocppStatusLabel(c.status)}`}
                        color={CONNECTOR_COLOR[c.status] ?? 'default'}
                      />
                    </Tooltip>
                  ))}
                  {!station.online && <Chip size="small" label="Offline" variant="outlined" />}
                </Stack>

                <Typography variant="body2" sx={{ mt: 2 }} color="text.secondary">
                  {station.waitingCount === 0
                    ? 'No one waiting'
                    : `${station.waitingCount} ${station.waitingCount === 1 ? 'person' : 'people'} waiting`}
                </Typography>
              </CardContent>
              <CardActions sx={{ px: 2, pb: 2 }}>
                <Button
                  variant="contained"
                  fullWidth
                  onClick={() => setJoinTarget({ kind: 'station', id: station.id, name: station.name })}
                >
                  Join waitlist
                </Button>
              </CardActions>
            </Card>
          </Grid>
        ))}
        {stations.length === 0 && zones.length === 0 && (
          <Grid size={12}>
            <Typography color="text.secondary">No stations are configured yet.</Typography>
          </Grid>
        )}
      </Grid>

      {joinTarget && (
        <WaitlistJoinDialog target={joinTarget} onClose={() => setJoinTarget(null)} onJoined={handleJoined} />
      )}
    </Container>
  );
}
