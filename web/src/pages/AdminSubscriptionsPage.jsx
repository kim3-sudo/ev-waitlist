import { useEffect, useState } from 'react';
import { Alert, Button, Container, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

// Charging plans: a monthly fee and a discount on sessions. Subscribers are enrolled by their ID tag.
// Plan fees are put on invoices to the subscriber's billing customer, once a month, with the button below.

const money = (cents, currency = 'USD') => new Intl.NumberFormat('en-US', { style: 'currency', currency }).format((cents ?? 0) / 100);

export function AdminSubscriptionsPage() {
  const { can } = useAuth();
  const canManage = can('payments.manage');
  const [plans, setPlans] = useState([]);
  const [subs, setSubs] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [planForm, setPlanForm] = useState({ name: '', description: '', monthlyFeeCents: 0, discountPercent: 0 });
  const [subForm, setSubForm] = useState({ planId: '', idTag: '', driverName: '', billingCustomerId: '' });
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function load() {
    const [p, s, c] = await Promise.all([
      api.get('/api/admin/subscriptions/plans'),
      api.get('/api/admin/subscriptions/subscriptions'),
      api.get('/api/admin/billing/customers'),
    ]);
    setPlans(p.data.data);
    setSubs(s.data.data);
    setCustomers(c.data.data);
  }

  useEffect(() => {
    load().catch(() => setError('Charging plans could not be loaded.'));
  }, []);

  async function run(action, success) {
    setError('');
    setMessage('');
    try {
      const out = await action();
      setMessage(typeof success === 'function' ? success(out) : success);
      await load();
    } catch (err) {
      setError(err.response?.data?.error ?? 'The request failed.');
    }
  }

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Stack spacing={3}>
        <Typography variant="h5" fontWeight={600}>Charging plans</Typography>
        {message && <Alert severity="success" onClose={() => setMessage('')}>{message}</Alert>}
        {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}

        <Paper sx={{ p: 2 }}>
          <Typography variant="h6" gutterBottom>Plans</Typography>
          {canManage && (
            <Stack component="form" direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 2 }} onSubmit={(e) => {
              e.preventDefault();
              run(() => api.post('/api/admin/subscriptions/plans', planForm), 'Plan added.');
              setPlanForm({ name: '', description: '', monthlyFeeCents: 0, discountPercent: 0 });
            }}>
              <TextField label="Name" size="small" required value={planForm.name} onChange={(e) => setPlanForm({ ...planForm, name: e.target.value })} />
              <TextField label="Monthly fee (cents)" size="small" type="number" value={planForm.monthlyFeeCents} onChange={(e) => setPlanForm({ ...planForm, monthlyFeeCents: e.target.value })} />
              <TextField label="Discount (%)" size="small" type="number" value={planForm.discountPercent} onChange={(e) => setPlanForm({ ...planForm, discountPercent: e.target.value })} />
              <TextField label="Description" size="small" value={planForm.description} onChange={(e) => setPlanForm({ ...planForm, description: e.target.value })} fullWidth />
              <Button type="submit" variant="contained">Add plan</Button>
            </Stack>
          )}
          {plans.length === 0 ? (
            <Typography color="text.secondary">No plans yet.</Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell align="right">Monthly fee</TableCell>
                  <TableCell align="right">Discount</TableCell>
                  <TableCell align="right">Subscribers</TableCell>
                  <TableCell>Status</TableCell>
                  {canManage && <TableCell align="right">Actions</TableCell>}
                </TableRow>
              </TableHead>
              <TableBody>
                {plans.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{p.name}</TableCell>
                    <TableCell align="right">{money(p.monthlyFeeCents, p.currency)}</TableCell>
                    <TableCell align="right">{p.discountPercent}%</TableCell>
                    <TableCell align="right">{p.subscriberCount}</TableCell>
                    <TableCell>{p.active ? 'Open' : 'Closed to new subscribers'}</TableCell>
                    {canManage && (
                      <TableCell align="right">
                        <Button size="small" onClick={() => run(() => api.patch(`/api/admin/subscriptions/plans/${p.id}`, { active: !p.active }), p.active ? 'Plan closed to new subscribers.' : 'Plan opened.')}>
                          {p.active ? 'Close' : 'Open'}
                        </Button>
                        <Button size="small" color="error" onClick={() => run(() => api.delete(`/api/admin/subscriptions/plans/${p.id}`), 'Plan deleted.')}>Delete</Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Paper>

        <Paper sx={{ p: 2 }}>
          <Typography variant="h6" gutterBottom>Subscribers</Typography>
          {canManage && plans.length > 0 && (
            <Stack component="form" direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 2 }} onSubmit={(e) => {
              e.preventDefault();
              run(() => api.post('/api/admin/subscriptions/subscriptions', { ...subForm, billingCustomerId: subForm.billingCustomerId || null }), 'Driver enrolled.');
              setSubForm({ planId: '', idTag: '', driverName: '', billingCustomerId: '' });
            }}>
              <TextField select label="Plan" size="small" required value={subForm.planId} onChange={(e) => setSubForm({ ...subForm, planId: e.target.value })} sx={{ minWidth: 180 }}>
                {plans.filter((p) => p.active).map((p) => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
              </TextField>
              <TextField label="Driver's ID tag" size="small" required value={subForm.idTag} onChange={(e) => setSubForm({ ...subForm, idTag: e.target.value })} />
              <TextField label="Name (optional)" size="small" value={subForm.driverName} onChange={(e) => setSubForm({ ...subForm, driverName: e.target.value })} />
              <TextField select label="Bill fees to (optional)" size="small" value={subForm.billingCustomerId} onChange={(e) => setSubForm({ ...subForm, billingCustomerId: e.target.value })} sx={{ minWidth: 200 }}>
                <MenuItem value="">Not billed</MenuItem>
                {customers.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
              </TextField>
              <Button type="submit" variant="contained">Enrol</Button>
            </Stack>
          )}
          {canManage && (
            <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
              <Button variant="outlined" onClick={() => run(() => api.post('/api/admin/subscriptions/bill', {}), (out) =>
                `This month: ${out.invoicesIssued} invoice(s) issued for ${out.subscriptionsBilled} subscription(s). ${out.skippedWithoutBillingCustomer ? `${out.skippedWithoutBillingCustomer} without a billing customer were not billed.` : ''}`)}>
                Bill this month's plan fees
              </Button>
              <Typography variant="caption" color="text.secondary">Each subscription is billed once a month.</Typography>
            </Stack>
          )}
          {subs.length === 0 ? (
            <Typography color="text.secondary">No subscribers yet.</Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>ID tag</TableCell>
                  <TableCell>Name</TableCell>
                  <TableCell>Plan</TableCell>
                  <TableCell>Billed to</TableCell>
                  <TableCell>Last billed</TableCell>
                  <TableCell>Status</TableCell>
                  {canManage && <TableCell align="right">Actions</TableCell>}
                </TableRow>
              </TableHead>
              <TableBody>
                {subs.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell sx={{ fontFamily: 'monospace' }}>{s.idTag}</TableCell>
                    <TableCell>{s.driverName ?? '—'}</TableCell>
                    <TableCell>{s.planName}</TableCell>
                    <TableCell>{s.billingCustomerName ?? 'Not billed'}</TableCell>
                    <TableCell>{s.lastBilledPeriod ?? '—'}</TableCell>
                    <TableCell>{s.status === 'ACTIVE' ? 'Active' : 'Cancelled'}</TableCell>
                    {canManage && (
                      <TableCell align="right">
                        {s.status === 'ACTIVE' && (
                          <Button size="small" color="error" onClick={() => run(() => api.post(`/api/admin/subscriptions/subscriptions/${s.id}/cancel`), 'Subscription cancelled.')}>Cancel</Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Paper>
      </Stack>
    </Container>
  );
}
