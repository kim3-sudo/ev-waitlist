import { useEffect, useState } from 'react';
import { Container, Paper, Stack, TextField, Typography } from '@mui/material';
import { api } from '../api/client.js';
import { IdleReportTable } from '../components/IdleReportTable.jsx';

const POLL_MS = 8000;

export function IdleReportPage() {
  const [idle, setIdle] = useState(null);
  const [minMinutes, setMinMinutes] = useState(10);

  async function refresh() {
    const { data } = await api.get('/api/admin/reports/idle', { params: { minMinutes, days: 7 } });
    setIdle(data);
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [minMinutes]);

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' }, mb: 2 }}>
        <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }}>
          Connectors where the vehicle stayed plugged in after the session ended, over the last 7 days.
          {idle && ` ${idle.flaggedCount} at or over ${idle.minMinutes} min, ${idle.ongoingCount} still idle now.`}
        </Typography>
        <TextField
          size="small"
          type="number"
          label="Flag after (minutes)"
          value={minMinutes}
          onChange={(e) => setMinMinutes(Math.max(0, Number(e.target.value) || 0))}
          slotProps={{ htmlInput: { min: 0, max: 1440 } }}
          sx={{ width: 200 }}
        />
      </Stack>
      <Paper variant="outlined">
        <IdleReportTable rows={idle?.rows ?? []} />
      </Paper>
    </Container>
  );
}
