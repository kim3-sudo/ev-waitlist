import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Box,
  Container,
  Paper,
  Tab,
  Tabs,
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
import { StationStatusDialog } from '../components/StationStatusDialog.jsx';
import { usePagedList } from '../api/paged.js';
import { LoadMore } from '../components/LoadMore.jsx';
import { DashboardView } from '../components/dashboard/DashboardView.jsx';

const POLL_MS = 8000;

// The admin home page: a dashboard, and the charge points list. The tab is kept in the
// address (?view=stations) so a link can open either one.
export function AdminStationsPage() {
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'stations' ? 'stations' : 'dashboard';
  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Tabs
        value={view}
        onChange={(_, next) => setParams(next === 'dashboard' ? {} : { view: next }, { replace: true })}
        sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab value="dashboard" label="Dashboard" />
        <Tab value="stations" label="Charge points" />
      </Tabs>
      {view === 'dashboard' ? <DashboardView /> : <ChargePointsView />}
    </Container>
  );
}

function ChargePointsView() {
  const { can } = useAuth();
  const canManage = can('stations.manage');
  const list = usePagedList('/api/admin/stations', { pollMs: POLL_MS });
  const stations = list.items;
  const refresh = list.reload;
  const [wizardOpen, setWizardOpen] = useState(false);
  const [formTarget, setFormTarget] = useState(undefined); // undefined = closed, null = create, station = edit
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [search, setSearch] = useState('');
  const [statusTarget, setStatusTarget] = useState(null);

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
    <Box>
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
          onStatus={setStatusTarget}
          readOnly={!canManage}
        />
        <LoadMore hasMore={list.hasMore} loading={list.loading} onLoadMore={list.loadMore} />
      </Paper>

      {statusTarget && <StationStatusDialog stationId={statusTarget.id} onClose={() => setStatusTarget(null)} />}

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
    </Box>
  );
}
