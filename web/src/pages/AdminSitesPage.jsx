import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Container,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

// Sites and the operator are managed by the installation administrator only.
export function AdminSitesPage() {
  const { isInstanceAdmin } = useAuth();
  const [sites, setSites] = useState([]);
  const [operator, setOperator] = useState({ name: '', countryCode: '', partyId: '' });
  const [newSite, setNewSite] = useState({ name: '', slug: '' });
  const [adminForm, setAdminForm] = useState({ siteId: '', email: '', password: '' });
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const [sitesRes, operatorRes] = await Promise.all([api.get('/api/admin/sites'), api.get('/api/admin/operator')]);
    setSites(sitesRes.data);
    setOperator(operatorRes.data);
    setAdminForm((f) => ({ ...f, siteId: f.siteId || sitesRes.data[0]?.id || '' }));
  }

  useEffect(() => {
    if (!isInstanceAdmin) return;
    load().catch(() => setMessage({ severity: 'error', text: 'Could not load sites.' }));
  }, [isInstanceAdmin]);

  if (!isInstanceAdmin) {
    return (
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Alert severity="info">Only the installation administrator can manage sites.</Alert>
      </Container>
    );
  }

  async function run(action, okText) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      setMessage({ severity: 'success', text: okText });
      await load();
    } catch (err) {
      setMessage({ severity: 'error', text: err.response?.data?.error ?? 'Something went wrong.' });
    } finally {
      setBusy(false);
    }
  }

  const createSite = () =>
    run(async () => {
      await api.post('/api/admin/sites', newSite);
      setNewSite({ name: '', slug: '' });
    }, 'Site created.');

  const deleteSite = (site) =>
    run(() => api.delete(`/api/admin/sites/${site.id}`), `Deleted ${site.name}.`);

  const addAdmin = () =>
    run(async () => {
      await api.post(`/api/admin/sites/${adminForm.siteId}/admins`, {
        email: adminForm.email,
        password: adminForm.password,
      });
      setAdminForm((f) => ({ ...f, email: '', password: '' }));
    }, 'Administrator added. They must change the starting passphrase at first sign-in.');

  const saveOperator = () =>
    run(() => api.put('/api/admin/operator', operator), 'Operator saved.');

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      {message && (
        <Alert severity={message.severity} sx={{ mb: 2 }} onClose={() => setMessage(null)}>
          {message.text}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 3 }}>
        <Stack spacing={2}>
          <Typography variant="h6">Sites</Typography>
          <Typography variant="body2" color="text.secondary">
            Each site has its own charge points, administrators, branding, payments and roaming settings. A site can be
            deleted only when it has no charge points, administrators or history. The first site cannot be deleted.
          </Typography>

          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Address</TableCell>
                <TableCell align="right">Charge points</TableCell>
                <TableCell align="right">Administrators</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {sites.map((site) => (
                <TableRow key={site.id}>
                  <TableCell>{site.name}</TableCell>
                  <TableCell>{site.isDefault ? 'First site' : `/t/${site.slug}`}</TableCell>
                  <TableCell align="right">{site.stationCount}</TableCell>
                  <TableCell align="right">{site.adminCount}</TableCell>
                  <TableCell align="right">
                    <Button size="small" color="error" disabled={busy || site.isDefault} onClick={() => deleteSite(site)}>
                      Delete
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <Typography variant="subtitle2" sx={{ mt: 2 }}>
            New site
          </Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Site name"
              value={newSite.name}
              onChange={(e) => setNewSite((s) => ({ ...s, name: e.target.value }))}
              fullWidth
            />
            <TextField
              label="Address (used in links)"
              helperText="Letters, numbers and hyphens. Cannot be changed later."
              value={newSite.slug}
              onChange={(e) => setNewSite((s) => ({ ...s, slug: e.target.value.toLowerCase() }))}
              fullWidth
            />
            <Button variant="contained" disabled={busy || !newSite.name || !newSite.slug} onClick={createSite}>
              Create
            </Button>
          </Stack>

          <Typography variant="subtitle2" sx={{ mt: 2 }}>
            Add an administrator to a site
          </Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              select
              label="Site"
              value={adminForm.siteId}
              onChange={(e) => setAdminForm((f) => ({ ...f, siteId: e.target.value }))}
              sx={{ minWidth: 180 }}
            >
              {sites.map((site) => (
                <MenuItem key={site.id} value={site.id}>
                  {site.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Email"
              value={adminForm.email}
              onChange={(e) => setAdminForm((f) => ({ ...f, email: e.target.value }))}
              fullWidth
            />
            <TextField
              label="Starting passphrase"
              type="password"
              helperText="At least 8 characters. They choose their own at first sign-in."
              value={adminForm.password}
              onChange={(e) => setAdminForm((f) => ({ ...f, password: e.target.value }))}
              fullWidth
            />
          </Stack>
          <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
            <Button
              variant="outlined"
              disabled={busy || !adminForm.siteId || !adminForm.email || adminForm.password.length < 8}
              onClick={addAdmin}
            >
              Add administrator
            </Button>
          </Stack>
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 3, mt: 3 }}>
        <Stack spacing={2}>
          <Typography variant="h6">Operator</Typography>
          <Typography variant="body2" color="text.secondary">
            The company that runs this installation. The country code and party ID are used only for roaming, and are
            assigned to you by the roaming scheme or your partners. Leave them blank if you do not roam.
          </Typography>
          <TextField
            label="Operator name"
            value={operator.name}
            onChange={(e) => setOperator((o) => ({ ...o, name: e.target.value }))}
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Country code"
              helperText="Two letters, e.g. GB"
              value={operator.countryCode}
              onChange={(e) => setOperator((o) => ({ ...o, countryCode: e.target.value.toUpperCase() }))}
              slotProps={{ htmlInput: { maxLength: 2 } }}
            />
            <TextField
              label="Party ID"
              helperText="Three letters or numbers"
              value={operator.partyId}
              onChange={(e) => setOperator((o) => ({ ...o, partyId: e.target.value.toUpperCase() }))}
              slotProps={{ htmlInput: { maxLength: 3 } }}
            />
          </Stack>
          <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
            <Button variant="contained" disabled={busy} onClick={saveOperator}>
              Save operator
            </Button>
          </Stack>
        </Stack>
      </Paper>
    </Container>
  );
}
