import { useEffect, useState } from 'react';
import { Container, Paper, Typography } from '@mui/material';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { LineCuttingComplaintsTable } from '../components/LineCuttingComplaintsTable.jsx';

const POLL_MS = 8000;

export function AdminComplaintsPage() {
  const { can } = useAuth();
  const [complaints, setComplaints] = useState([]);

  async function refresh() {
    const { data } = await api.get('/api/admin/complaints');
    setComplaints(data);
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, []);

  async function handleUpdateStatus(id, status) {
    await api.patch(`/api/admin/complaints/${id}`, { status });
    refresh();
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Typography variant="h5" fontWeight={600} sx={{ mb: 2 }}>
        Line-cutting complaints
      </Typography>
      <Paper variant="outlined">
        <LineCuttingComplaintsTable
          complaints={complaints}
          onUpdateStatus={handleUpdateStatus}
          readOnly={!can('complaints.manage')}
        />
      </Paper>
    </Container>
  );
}
