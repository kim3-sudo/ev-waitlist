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

const STATUS = {
  ACTIVE: { label: 'Active', color: 'success' },
  SCHEDULED: { label: 'Scheduled', color: 'info' },
  ENDED: { label: 'Ended', color: 'default' },
};

const SURGE_LIMITS = { min: -99, max: 300 };

function changeLabel(rule) {
  if (rule.kind === 'COMPLIMENTARY') return 'Complimentary charging';
  return `Surge ${rule.percent > 0 ? '+' : ''}${rule.percent}%`;
}

function appliesTo(rule) {
  switch (rule.scope) {
    case 'NETWORK':
      return 'Whole network';
    case 'SITE':
      return 'This site: every charge point';
    case 'ZONE':
      return `Group: ${rule.zoneName ?? 'removed'}`;
    case 'STATION':
      return `Charge point: ${rule.stationName ?? 'removed'}`;
    case 'POWER_TYPE':
      return `${rule.powerClass} connectors`;
    default:
      return rule.scope;
  }
}

function RuleFormDialog({ rule, targets, isInstanceAdmin, onClose, onSaved }) {
  const isEdit = Boolean(rule);
  const [kind, setKind] = useState(rule?.kind ?? 'SURGE');
  const [percent, setPercent] = useState(rule?.percent == null ? '' : String(rule.percent));
  const [scope, setScope] = useState(rule?.scope ?? 'SITE');
  const [zoneId, setZoneId] = useState(rule?.zoneId ?? '');
  const [stationId, setStationId] = useState(rule?.stationId ?? '');
  const [powerClass, setPowerClass] = useState(rule?.powerClass ?? 'DC');
  const [label, setLabel] = useState(rule?.label ?? '');
  const [start, setStart] = useState(toLocalInput(rule?.startsAt ?? new Date()));
  const [end, setEnd] = useState(toLocalInput(rule?.endsAt));
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const isSurge = kind === 'SURGE';
  const scopes = [
    ...(isInstanceAdmin ? [['NETWORK', 'The whole network (every site)']] : []),
    ['SITE', 'This site: every charge point'],
    ['ZONE', 'A group of charge points (a zone)'],
    ['STATION', 'One charge point'],
    ['POWER_TYPE', 'All AC or all DC connectors'],
  ];

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    const body = {
      kind,
      scope,
      percent: isSurge ? Number(percent) : null,
      label: label.trim(),
      startsAt: fromLocalInput(start),
      endsAt: fromLocalInput(end),
      zoneId: scope === 'ZONE' ? zoneId : null,
      stationId: scope === 'STATION' ? stationId : null,
      powerClass: scope === 'POWER_TYPE' ? powerClass : null,
    };
    try {
      if (isEdit) await api.put(`/api/admin/price-rules/${rule.id}`, body);
      else await api.post('/api/admin/price-rules', body);
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not save the price change.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{isEdit ? 'Edit price change' : 'Add price change'}</DialogTitle>
      <form onSubmit={handleSubmit}>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField select label="Type" value={kind} onChange={(e) => setKind(e.target.value)} fullWidth>
              <MenuItem value="SURGE">Surge pricing: raise or lower the price for a time</MenuItem>
              <MenuItem value="COMPLIMENTARY">Complimentary charging: charging is free</MenuItem>
            </TextField>
            {isSurge && (
              <TextField
                label="Price change (%)"
                type="number"
                value={percent}
                onChange={(e) => setPercent(e.target.value)}
                helperText={`A plus sign raises the price, a minus sign lowers it, e.g. 25 or -15 (from ${SURGE_LIMITS.min} to +${SURGE_LIMITS.max}).`}
                slotProps={{ htmlInput: { min: SURGE_LIMITS.min, max: SURGE_LIMITS.max, step: 1 } }}
                required
                fullWidth
              />
            )}
            <TextField select label="Applies to" value={scope} onChange={(e) => setScope(e.target.value)} fullWidth>
              {scopes.map(([value, text]) => (
                <MenuItem key={value} value={value}>
                  {text}
                </MenuItem>
              ))}
            </TextField>
            {scope === 'ZONE' && (
              <TextField select label="Group" value={zoneId} onChange={(e) => setZoneId(e.target.value)} required fullWidth>
                {targets.zones.map((z) => (
                  <MenuItem key={z.id} value={z.id}>
                    {z.name}
                  </MenuItem>
                ))}
              </TextField>
            )}
            {scope === 'STATION' && (
              <TextField select label="Charge point" value={stationId} onChange={(e) => setStationId(e.target.value)} required fullWidth>
                {targets.stations.map((s) => (
                  <MenuItem key={s.id} value={s.id}>
                    {s.name}
                  </MenuItem>
                ))}
              </TextField>
            )}
            {scope === 'POWER_TYPE' && (
              <TextField select label="Connector type" value={powerClass} onChange={(e) => setPowerClass(e.target.value)} fullWidth>
                <MenuItem value="AC">AC connectors</MenuItem>
                <MenuItem value="DC">DC connectors</MenuItem>
              </TextField>
            )}
            <TextField
              label="Reason (optional)"
              helperText="Shown to drivers on the waitlist page, e.g. Event night."
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              slotProps={{ htmlInput: { maxLength: 120 } }}
              fullWidth
            />
            <ScheduleFields
              start={start}
              end={end}
              onStart={setStart}
              onEnd={setEnd}
              endRequired={isSurge}
              endHelp={isSurge ? 'The price goes back to normal at this time.' : 'Leave empty to keep it on until you turn it off.'}
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

export function AdminPriceRulesPage() {
  const { can, isInstanceAdmin } = useAuth();
  const canManage = can('payments.manage');
  const list = usePagedList('/api/admin/price-rules');
  const rules = list.items;
  const [targets, setTargets] = useState({ stations: [], zones: [], locations: [] });
  const [formTarget, setFormTarget] = useState(undefined); // undefined = closed, null = create, rule = edit
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [error, setError] = useState('');

  async function refresh() {
    const [, targetsRes] = await Promise.all([list.reload(), api.get('/api/admin/price-rules/targets')]);
    setTargets(targetsRes.data);
  }

  useEffect(() => {
    refresh().catch(() => setError('Could not load price changes.'));
  }, []);

  async function handleDelete() {
    setError('');
    try {
      await api.delete(`/api/admin/price-rules/${deleteTarget.id}`);
      setDeleteTarget(null);
      refresh();
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not remove the price change.');
      setDeleteTarget(null);
    }
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5" fontWeight={600}>
          Price changes
        </Typography>
        {canManage && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setFormTarget(null)}>
            Add price change
          </Button>
        )}
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Surge pricing raises or lowers what drivers pay for a set time, to meet demand. Complimentary charging makes charging
        free. Each applies to the whole network, this site, a group of charge points, one charge point, or all AC or all DC
        connectors. Where two overlap, complimentary charging wins, then the most specific change. Each charge is priced at the
        change in effect when that minute or hour starts.
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
              <TableCell>Change</TableCell>
              <TableCell>Applies to</TableCell>
              <TableCell>Reason</TableCell>
              <TableCell>Starts</TableCell>
              <TableCell>Ends</TableCell>
              {canManage && <TableCell align="right">Actions</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {rules.map((rule) => (
              <TableRow key={rule.id} hover>
                <TableCell>
                  <Chip size="small" label={STATUS[rule.status].label} color={STATUS[rule.status].color} />
                </TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    variant="outlined"
                    color={rule.kind === 'COMPLIMENTARY' ? 'success' : 'warning'}
                    label={changeLabel(rule)}
                  />
                </TableCell>
                <TableCell>
                  {appliesTo(rule)}
                  {rule.network && !isInstanceAdmin ? ' (set by the installation administrator)' : ''}
                </TableCell>
                <TableCell>{rule.label}</TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatWhen(rule.startsAt)}</TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{rule.endsAt ? formatWhen(rule.endsAt) : 'Until turned off'}</TableCell>
                {canManage && (
                  <TableCell align="right">
                    {rule.canEdit && (
                      <>
                        <IconButton size="small" onClick={() => setFormTarget(rule)} aria-label="Edit">
                          <EditIcon fontSize="small" />
                        </IconButton>
                        <IconButton size="small" color="error" onClick={() => setDeleteTarget(rule)} aria-label="Remove">
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
            {rules.length === 0 && (
              <TableRow>
                <TableCell colSpan={canManage ? 7 : 6}>
                  <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                    No price changes.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        <LoadMore hasMore={list.hasMore} loading={list.loading} onLoadMore={list.loadMore} />
      </Paper>

      {formTarget !== undefined && (
        <RuleFormDialog
          rule={formTarget}
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
        <DialogTitle>Remove this price change?</DialogTitle>
        <DialogContent>
          <Typography>Charges that have already been made keep their price. This can't be undone.</Typography>
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
