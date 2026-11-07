import { useEffect, useState } from 'react';
import { Alert, Container, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { ComplaintsSummaryTable } from '../components/ComplaintsSummaryTable.jsx';
import { LineCuttingComplaintsTable } from '../components/LineCuttingComplaintsTable.jsx';
import { usePagedList } from '../api/paged.js';
import { LoadMore } from '../components/LoadMore.jsx';

const POLL_MS = 8000;
const WINDOWS = [
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
];

// Line-cutting complaints: the summary by station, and the complaints themselves, where
// they can be resolved or dismissed. The list needs the complaints permission.
export function ComplaintsSummaryPage() {
  const { can } = useAuth();
  const canView = can('complaints.view');
  const [summary, setSummary] = useState(null);
  const complaintList = usePagedList('/api/admin/complaints', { enabled: canView });
  const complaints = complaintList.items;
  const [days, setDays] = useState(30);

  async function refresh() {
    const { data } = await api.get('/api/admin/reports/complaints-summary', { params: { days } });
    setSummary(data);
    if (canView) await complaintList.reload();
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [days, canView]);

  async function handleUpdateStatus(id, status) {
    await api.patch(`/api/admin/complaints/${id}`, { status });
    refresh();
  }

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
      <Paper variant="outlined" sx={{ mb: 4 }}>
        <ComplaintsSummaryTable rows={summary?.rows ?? []} />
      </Paper>

      <Typography variant="h6" fontWeight={600} sx={{ mb: 1 }}>
        Complaints to review
      </Typography>
      {canView ? (
        <Paper variant="outlined">
          <LineCuttingComplaintsTable
            complaints={complaints}
            onUpdateStatus={handleUpdateStatus}
            readOnly={!can('complaints.manage')}
          />
          <LoadMore hasMore={complaintList.hasMore} loading={complaintList.loading} onLoadMore={complaintList.loadMore} />
        </Paper>
      ) : (
        <Alert severity="info">Your role can't view individual complaints. Ask an admin for access.</Alert>
      )}
    </Container>
  );
}
