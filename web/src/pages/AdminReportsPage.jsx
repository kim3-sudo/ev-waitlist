import { useEffect, useState } from 'react';
import { Container, Paper, Typography } from '@mui/material';
import { api } from '../api/client.js';
import { LineCutterReportsTable } from '../components/LineCutterReportsTable.jsx';

const POLL_MS = 8000;

export function AdminReportsPage() {
  const [reports, setReports] = useState([]);

  async function refresh() {
    const { data } = await api.get('/api/admin/reports');
    setReports(data);
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, []);

  async function handleUpdateStatus(id, status) {
    await api.patch(`/api/admin/reports/${id}`, { status });
    refresh();
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Typography variant="h5" fontWeight={600} sx={{ mb: 2 }}>
        Line-cutter reports
      </Typography>
      <Paper variant="outlined">
        <LineCutterReportsTable reports={reports} onUpdateStatus={handleUpdateStatus} />
      </Paper>
    </Container>
  );
}
