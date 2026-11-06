import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Container,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { api } from '../api/client.js';

const RANGES = [
  { value: 7, label: 'Last 7 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' },
];

const formatDay = (day) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
};

function Stat({ label, value }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, flex: 1, minWidth: 160 }}>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="h5" fontWeight={600}>{value}</Typography>
    </Paper>
  );
}

// Energy dispensed, from the meter readings at the start and end of each session.
export function EnergyReportPage() {
  const [days, setDays] = useState(30);
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setError('');
    api
      .get('/api/admin/reports/energy', { params: { days } })
      .then(({ data }) => setReport(data))
      .catch(() => setError('Could not load the energy report.'));
  }, [days]);

  const totals = report?.totals;
  const noReadings = totals && totals.sessions > 0 && totals.sessionsWithReading === 0;
  const maxDaily = Math.max(0, ...(report?.daily ?? []).map((d) => d.energyKwh));

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' }, mb: 2 }}>
        <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }}>
          Energy dispensed in each session, from the charger's meter readings. A session without a reading adds no energy.
        </Typography>
        <TextField select size="small" label="Period" value={days} onChange={(e) => setDays(Number(e.target.value))} sx={{ width: 200 }}>
          {RANGES.map((r) => (
            <MenuItem key={r.value} value={r.value}>{r.label}</MenuItem>
          ))}
        </TextField>
      </Stack>

      {error && <Alert severity="error">{error}</Alert>}
      {noReadings && (
        <Alert severity="info" sx={{ mb: 2 }}>
          None of these sessions has a meter reading, so the energy can't be shown. Check that the charger reports its meter values.
        </Alert>
      )}

      {totals && (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 3 }}>
          <Stat label="Energy dispensed" value={`${totals.energyKwh.toLocaleString()} kWh`} />
          <Stat label="Sessions" value={totals.sessions.toLocaleString()} />
          <Stat label="Sessions with a reading" value={totals.sessionsWithReading.toLocaleString()} />
          <Stat label="Sessions without a reading" value={totals.sessionsWithoutReading.toLocaleString()} />
        </Stack>
      )}

      {report && (
        <Stack spacing={3}>
          <Paper variant="outlined">
            <Typography variant="subtitle1" fontWeight={600} sx={{ p: 2 }}>By charge point</Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Charge point</TableCell>
                  <TableCell align="right">Sessions</TableCell>
                  <TableCell align="right">Energy (kWh)</TableCell>
                  <TableCell align="right">Average per session (kWh)</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {report.stations.length === 0 && (
                  <TableRow><TableCell colSpan={4}><Typography color="text.secondary">No sessions in this period.</Typography></TableCell></TableRow>
                )}
                {report.stations.map((s) => (
                  <TableRow key={s.stationId}>
                    <TableCell>{s.stationName}</TableCell>
                    <TableCell align="right">{s.sessions}</TableCell>
                    <TableCell align="right">{s.energyKwh.toLocaleString()}</TableCell>
                    <TableCell align="right">{s.averageKwhPerSession ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>

          <Paper variant="outlined">
            <Typography variant="subtitle1" fontWeight={600} sx={{ p: 2 }}>By day</Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Day</TableCell>
                  <TableCell align="right">Sessions</TableCell>
                  <TableCell>Energy (kWh)</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {report.daily.length === 0 && (
                  <TableRow><TableCell colSpan={3}><Typography color="text.secondary">No sessions in this period.</Typography></TableCell></TableRow>
                )}
                {report.daily.map((d) => (
                  <TableRow key={d.day}>
                    <TableCell>{formatDay(d.day)}</TableCell>
                    <TableCell align="right">{d.sessions}</TableCell>
                    <TableCell sx={{ minWidth: 220 }}>
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                        <Box
                          aria-hidden
                          sx={{
                            height: 10,
                            borderRadius: 1,
                            bgcolor: 'primary.main',
                            width: maxDaily > 0 ? `${(d.energyKwh / maxDaily) * 100}%` : 0,
                            minWidth: d.energyKwh > 0 ? 2 : 0,
                          }}
                        />
                        <Typography variant="body2" sx={{ whiteSpace: 'nowrap' }}>{d.energyKwh.toLocaleString()}</Typography>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>
        </Stack>
      )}
    </Container>
  );
}
