import { useEffect, useState } from 'react';
import { Container, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import { api } from '../api/client.js';
import { ComplaintsSummaryTable } from '../components/ComplaintsSummaryTable.jsx';

const POLL_MS = 8000;
const WINDOWS = [
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
];

export function ComplaintsSummaryPage() {
  const [summary, setSummary] = useState(null);
  const [days, setDays] = useState(30);

  async function refresh() {
    const { data } = await api.get('/api/admin/reports/complaints-summary', { params: { days } });
    setSummary(data);
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [days]);

  const totals = summary?.totals;

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' }, mb: 2 }}>
        <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }}>
          Line-cutting complaints by station.
          {totals &&
            ` ${totals.total} filed, ${totals.open} still open.${
              totals.averageHoursToResolve !== null
                ? ` Complaints take about ${totals.averageHoursToResolve} h to close on average.`
                : ''
            }`}
        </Typography>
        <TextField select size="small" label="Window" value={days} onChange={(e) => setDays(Number(e.target.value))} sx={{ width: 200 }}>
          {WINDOWS.map((w) => (
            <MenuItem key={w.days} value={w.days}>
              {w.label}
            </MenuItem>
          ))}
        </TextField>
      </Stack>
      <Paper variant="outlined">
        <ComplaintsSummaryTable rows={summary?.rows ?? []} />
      </Paper>
    </Container>
  );
}
