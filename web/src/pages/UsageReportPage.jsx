import { useEffect, useState } from 'react';
import { Alert, Box, Container, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { api } from '../api/client.js';

const RANGES = [
  { value: 1, label: 'Last 24 hours' },
  { value: 7, label: 'Last 7 days' },
  { value: 30, label: 'Last 30 days' },
];

// The three uses of connector time, as colored segments.
const SEGMENTS = [
  { key: 'chargingPercent', label: 'Charging', color: 'primary.main' },
  { key: 'waitingPercent', label: 'Waiting for the car to move', color: 'warning.main' },
  { key: 'freePercent', label: 'Free', color: 'grey.300' },
];

function UsageBar({ row }) {
  if (row.chargingPercent == null) return <Typography variant="body2" color="text.secondary">No connectors</Typography>;
  return (
    <Stack spacing={0.5} sx={{ minWidth: 220 }}>
      <Box sx={{ display: 'flex', height: 12, borderRadius: 1, overflow: 'hidden', bgcolor: 'grey.200' }} role="img"
        aria-label={SEGMENTS.map((s) => `${s.label} ${row[s.key]} percent`).join(', ')}>
        {SEGMENTS.map((s) => (
          <Box key={s.key} sx={{ width: `${row[s.key]}%`, bgcolor: s.color }} />
        ))}
      </Box>
      <Typography variant="caption" color="text.secondary">
        {row.chargingPercent}% charging · {row.waitingPercent}% waiting · {row.freePercent}% free
      </Typography>
    </Stack>
  );
}

// How each charge point's connector time was used: charging, waiting for the car to move
// after charging finished, or free for the next driver.
export function UsageReportPage() {
  const [days, setDays] = useState(7);
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setError('');
    api
      .get('/api/admin/reports/usage', { params: { days } })
      .then(({ data }) => setReport(data))
      .catch(() => setError('Could not load the usage report.'));
  }, [days]);

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' }, mb: 2 }}>
        <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }}>
          How each connector's time was used. Charging is time with a car drawing power. Waiting is time after charging
          finished, while the car stayed plugged in. Free is time the next driver could use.
        </Typography>
        <TextField select size="small" label="Period" value={days} onChange={(e) => setDays(Number(e.target.value))} sx={{ width: 200 }}>
          {RANGES.map((r) => (
            <MenuItem key={r.value} value={r.value}>{r.label}</MenuItem>
          ))}
        </TextField>
      </Stack>

      {error && <Alert severity="error">{error}</Alert>}

      {report && (
        <Paper variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Charge point</TableCell>
                <TableCell align="right">Connectors</TableCell>
                <TableCell align="right">Sessions</TableCell>
                <TableCell align="right">Average session (min)</TableCell>
                <TableCell align="right">Charging (h)</TableCell>
                <TableCell align="right">Waiting (h)</TableCell>
                <TableCell align="right">Free (h)</TableCell>
                <TableCell>Share of connector time</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {report.rows.length === 0 && (
                <TableRow><TableCell colSpan={8}><Typography color="text.secondary">No charge points yet.</Typography></TableCell></TableRow>
              )}
              {report.rows.map((row) => (
                <TableRow key={row.stationId}>
                  <TableCell>{row.stationName}</TableCell>
                  <TableCell align="right">{row.connectors}</TableCell>
                  <TableCell align="right">{row.sessions}</TableCell>
                  <TableCell align="right">{row.averageSessionMinutes ?? '—'}</TableCell>
                  <TableCell align="right">{row.chargingHours}</TableCell>
                  <TableCell align="right">{row.waitingHours}</TableCell>
                  <TableCell align="right">{row.freeHours}</TableCell>
                  <TableCell><UsageBar row={row} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}
    </Container>
  );
}
