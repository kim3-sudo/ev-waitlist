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
  MenuItem,
  Alert,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { ScheduleFields, toLocalInput, fromLocalInput, formatWhen } from '../components/ScheduleFields.jsx';
import { usePagedList } from '../api/paged.js';
import { LoadMore } from '../components/LoadMore.jsx';

const MESSAGE_MAX = 500;

const SCOPE_LABEL = {
  NETWORK: 'Whole network',
  SITE: 'This site',
  LOCATION: 'Location',
  STATION: 'Charge point',
};

const STATUS = {
  ACTIVE: { label: 'Active', color: 'success' },
  SCHEDULED: { label: 'Scheduled', color: 'info' },
  ENDED: { label: 'Ended', color: 'default' },
};

function appliesTo(alert) {
  if (alert.scope === 'STATION') return `Charge point: ${alert.stationName ?? 'removed'}`;
  if (alert.scope === 'LOCATION') return `Location: ${alert.location}`;
  return SCOPE_LABEL[alert.scope];
}

function AlertFormDialog({ alert, targets, isInstanceAdmin, onClose, onSaved }) {
  const isEdit = Boolean(alert);
  const [scope, setScope] = useState(alert?.scope ?? 'SITE');
  const [stationId, setStationId] = useState(alert?.stationId ?? '');
  const [location, setLocation] = useState(alert?.location ?? '');
  const [severity, setSeverity] = useState(alert?.severity ?? 'INFO');
  const [message, setMessage] = useState(alert?.message ?? '');
  const [start, setStart] = useState(toLocalInput(alert?.startsAt ?? new Date()));
  const [end, setEnd] = useState(toLocalInput(alert?.endsAt));
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const scopes = [
    ...(isInstanceAdmin ? [['NETWORK', 'The whole network (every site)']] : []),
    ['SITE', 'This site: every charge point'],
    ['LOCATION', 'A location: the charge points at one place'],
    ['STATION', 'One charge point'],
  ];

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    const body = {
      scope,
      severity,
      message: message.trim(),
      startsAt: fromLocalInput(start),
      endsAt: fromLocalInput(end),
      stationId: scope === 'STATION' ? stationId : null,
      location: scope === 'LOCATION' ? location : null,
    };
    try {
      if (isEdit) await api.put(`/api/admin/alerts/${alert.id}`, body);
      else await api.post('/api/admin/alerts', body);
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not save the alert.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{isEdit ? 'Edit alert' : 'Add alert'}</DialogTitle>
      <form onSubmit={handleSubmit}>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField select label="Who sees it" value={scope} onChange={(e) => setScope(e.target.value)} fullWidth>
              {scopes.map(([value, label]) => (
                <MenuItem key={value} value={value}>
                  {label}
                </MenuItem>
              ))}
            </TextField>
            {scope === 'STATION' && (
              <TextField select label="Charge point" value={stationId} onChange={(e) => setStationId(e.target.value)} required fullWidth>
                {targets.stations.map((s) => (
                  <MenuItem key={s.id} value={s.id}>
                    {s.name}
                    {s.location ? ` (${s.location})` : ''}
                  </MenuItem>
                ))}
              </TextField>
            )}
            {scope === 'LOCATION' && (
              <TextField select label="Location" value={location} onChange={(e) => setLocation(e.target.value)} required fullWidth>
                {targets.locations.map((name) => (
                  <MenuItem key={name} value={name}>
                    {name}
                  </MenuItem>
                ))}
              </TextField>
            )}
            <TextField select label="Severity" value={severity} onChange={(e) => setSeverity(e.target.value)} fullWidth>
              <MenuItem value="INFO">Information</MenuItem>
              <MenuItem value="WARNING">Warning</MenuItem>
            </TextField>
            <TextField
              label="Message to drivers"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              multiline
              minRows={2}
              required
              fullWidth
              helperText={`${message.length}/${MESSAGE_MAX}`}
              slotProps={{ htmlInput: { maxLength: MESSAGE_MAX } }}
            />
            <ScheduleFields
              start={start}
              end={end}
              onStart={setStart}
              onEnd={setEnd}
              endHelp="Leave empty to keep the alert until you remove it."
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

export function AdminAlertsPage() {
  const { can, isInstanceAdmin } = useAuth();
  const canManage = can('alerts.manage');
  const list = usePagedList('/api/admin/alerts');
  const alerts = list.items;
  const [targets, setTargets] = useState({ stations: [], zones: [], locations: [] });
  const [formTarget, setFormTarget] = useState(undefined); // undefined = closed, null = create, alert = edit
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [error, setError] = useState('');

  async function refresh() {
    const [, targetsRes] = await Promise.all([list.reload(), api.get('/api/admin/alerts/targets')]);
    setTargets(targetsRes.data);
  }

  useEffect(() => {
    refresh().catch(() => setError('Could not load alerts.'));
  }, []);

  async function handleDelete() {
    setError('');
    try {
      await api.delete(`/api/admin/alerts/${deleteTarget.id}`);
      setDeleteTarget(null);
      refresh();
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not remove the alert.');
      setDeleteTarget(null);
    }
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5" fontWeight={600}>
          Alerts
        </Typography>
        {canManage && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setFormTarget(null)}>
            Add alert
          </Button>
        )}
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Alerts are shown to drivers on the waitlist page while they are active: for one charge point, every charge point at a
        location, this site, or the whole network. Use Warning for problems that affect charging, and Information for news.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Paper variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Status</TableCell>
              <TableCell>Applies to</TableCell>
              <TableCell>Severity</TableCell>
              <TableCell>Message</TableCell>
              <TableCell>Starts</TableCell>
              <TableCell>Ends</TableCell>
              {canManage && <TableCell align="right">Actions</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {alerts.map((alert) => (
              <TableRow key={alert.id} hover>
                <TableCell>
                  <Chip size="small" label={STATUS[alert.status].label} color={STATUS[alert.status].color} />
                </TableCell>
                <TableCell>
                  {appliesTo(alert)}
                  {alert.network && !isInstanceAdmin ? ' (set by the installation administrator)' : ''}
                </TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    variant="outlined"
                    color={alert.severity === 'WARNING' ? 'warning' : 'info'}
                    label={alert.severity === 'WARNING' ? 'Warning' : 'Information'}
                  />
                </TableCell>
                <TableCell sx={{ maxWidth: 360 }}>{alert.message}</TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatWhen(alert.startsAt)}</TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{alert.endsAt ? formatWhen(alert.endsAt) : 'Until removed'}</TableCell>
                {canManage && (
                  <TableCell align="right">
                    {alert.canEdit && (
                      <>
                        <IconButton size="small" onClick={() => setFormTarget(alert)} aria-label="Edit">
                          <EditIcon fontSize="small" />
                        </IconButton>
                        <IconButton size="small" color="error" onClick={() => setDeleteTarget(alert)} aria-label="Remove">
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
            {alerts.length === 0 && (
              <TableRow>
                <TableCell colSpan={canManage ? 7 : 6}>
                  <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                    No alerts.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        <LoadMore hasMore={list.hasMore} loading={list.loading} onLoadMore={list.loadMore} />
      </Paper>

      {formTarget !== undefined && (
        <AlertFormDialog
          alert={formTarget}
          targets={targets}
          isInstanceAdmin={isInstanceAdmin}
          onClose={() => setFormTarget(undefined)}
          onSaved={() => {
            setFormTarget(undefined);
            refresh();
          }}
        />
      )}

      <Dialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)}>
        <DialogTitle>Remove this alert?</DialogTitle>
        <DialogContent>
          <Typography>Drivers will stop seeing it. This can't be undone.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleDelete}>
            Remove
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
