import { useEffect, useState } from 'react';
import {
  Container,
  Typography,
  Paper,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Chip,
  IconButton,
  Button,
  Stack,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Alert,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import { api } from '../api/client.js';

function ZoneFormDialog({ zone, onClose, onSaved }) {
  const isEdit = Boolean(zone);
  const [name, setName] = useState(zone?.name ?? '');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      if (isEdit) {
        await api.put(`/api/admin/zones/${zone.id}`, { name });
      } else {
        await api.post('/api/admin/zones', { name });
      }
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not save the zone.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{isEdit ? 'Rename zone' : 'Add zone'}</DialogTitle>
      <form onSubmit={handleSubmit}>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              label="Zone name"
              helperText='e.g. "Parking Garage P1"'
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={submitting}>
            {submitting ? 'Saving…' : 'Save'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

export function AdminZonesPage() {
  const [zones, setZones] = useState([]);
  const [formTarget, setFormTarget] = useState(undefined); // undefined = closed, null = create, zone = edit
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [error, setError] = useState('');

  async function refresh() {
    const { data } = await api.get('/api/admin/zones');
    setZones(data);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleDelete() {
    setError('');
    try {
      await api.delete(`/api/admin/zones/${deleteTarget.id}`);
      setDeleteTarget(null);
      refresh();
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not delete the zone.');
      setDeleteTarget(null);
    }
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5" fontWeight={600}>
          Zones
        </Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setFormTarget(null)}>
          Add zone
        </Button>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Group charge points that share one waitlist -- whichever charger in a zone frees up first is offered to the
        next person in that zone's line. Assign charge points to a zone from the Charge points tab.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Paper variant="outlined">
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Charge points</TableCell>
              <TableCell>Waiting</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {zones.map((zone) => (
              <TableRow key={zone.id} hover>
                <TableCell>{zone.name}</TableCell>
                <TableCell>
                  {zone.stations.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                      None assigned
                    </Typography>
                  ) : (
                    <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
                      {zone.stations.map((s) => (
                        <Chip key={s.id} size="small" label={s.name} variant="outlined" />
                      ))}
                    </Stack>
                  )}
                </TableCell>
                <TableCell>{zone.waitingCount}</TableCell>
                <TableCell align="right">
                  <IconButton size="small" onClick={() => setFormTarget(zone)} aria-label="Rename">
                    <EditIcon fontSize="small" />
                  </IconButton>
                  <IconButton
                    size="small"
                    color="error"
                    onClick={() => setDeleteTarget(zone)}
                    aria-label="Delete"
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
            {zones.length === 0 && (
              <TableRow>
                <TableCell colSpan={4}>
                  <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                    No zones yet.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>

      {formTarget !== undefined && (
        <ZoneFormDialog
          zone={formTarget}
          onClose={() => setFormTarget(undefined)}
          onSaved={() => {
            setFormTarget(undefined);
            refresh();
          }}
        />
      )}

      <Dialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)}>
        <DialogTitle>Delete zone?</DialogTitle>
        <DialogContent>
          <Typography>This can't be undone.</Typography>
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
