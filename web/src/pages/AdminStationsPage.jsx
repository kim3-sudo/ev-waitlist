import { useEffect, useMemo, useState } from 'react';
import {
  Container,
  Paper,
  Typography,
  Button,
  Stack,
  TextField,
  InputAdornment,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import SearchIcon from '@mui/icons-material/Search';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { StationsTable } from '../components/StationsTable.jsx';
import { StationFormDialog } from '../components/StationFormDialog.jsx';
import { ChargePointWizardDialog } from '../components/ChargePointWizardDialog.jsx';

const POLL_MS = 8000;

export function AdminStationsPage() {
  const { can } = useAuth();
  const canManage = can('stations.manage');
  const [stations, setStations] = useState([]);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [formTarget, setFormTarget] = useState(undefined); // undefined = closed, null = create, station = edit
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [search, setSearch] = useState('');

  async function refresh() {
    const { data } = await api.get('/api/admin/stations');
    setStations(data);
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, []);

  async function handleDelete() {
    await api.delete(`/api/admin/stations/${deleteTarget.id}`);
    setDeleteTarget(null);
    refresh();
  }

  const filteredStations = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return stations;
    return stations.filter((station) =>
      [station.name, station.identity, station.location].some((field) => field?.toLowerCase().includes(query)),
    );
  }, [stations, search]);

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5" fontWeight={600}>
          Charge points
        </Typography>
        {canManage && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setWizardOpen(true)}>
            Add charge point
          </Button>
        )}
      </Stack>

      <TextField
        placeholder="Search by name, identity, or location"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        size="small"
        fullWidth
        sx={{ mb: 2 }}
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          },
        }}
      />

      <Paper variant="outlined">
        <StationsTable
          stations={filteredStations}
          onEdit={setFormTarget}
          onDelete={setDeleteTarget}
          readOnly={!canManage}
        />
      </Paper>

      {wizardOpen && (
        <ChargePointWizardDialog
          onClose={() => {
            setWizardOpen(false);
            refresh();
          }}
          onCreated={refresh}
          onSwitchToForm={() => {
            setWizardOpen(false);
            setFormTarget(null);
          }}
        />
      )}

      {formTarget !== undefined && (
        <StationFormDialog
          station={formTarget}
          onClose={() => setFormTarget(undefined)}
          onSaved={() => {
            setFormTarget(undefined);
            refresh();
          }}
        />
      )}

      <Dialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)}>
        <DialogTitle>Delete charge point?</DialogTitle>
        <DialogContent>
          <Typography>
            This removes “{deleteTarget?.name}” and its waitlist/reservation history. This can't be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleDelete}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
