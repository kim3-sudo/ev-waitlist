import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

// Billing: tax rules, invoices and credit notes, consumer receipts, B2B customers, and the business
// details printed on documents. Reads need payments.view; changes need payments.manage.

const money = (cents, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format((cents ?? 0) / 100);
const when = (iso) => (iso ? new Date(iso).toLocaleDateString() : '—');
const percent = (bps) => `${(bps / 100).toFixed(2).replace(/\.00$/, '')}%`;

// Opens a printable page the server renders, through the authenticated API.
async function openDocument(url) {
  const { data } = await api.get(url, { responseType: 'text' });
  const href = URL.createObjectURL(new Blob([data], { type: 'text/html' }));
  window.open(href, '_blank', 'noopener');
}

const emptyRule = {
  name: '',
  jurisdiction: '',
  ratePercent: '',
  mode: 'EXCLUSIVE',
  appliesTo: 'ALL',
  scope: 'SITE',
  zoneId: '',
  stationId: '',
  validFrom: '',
  validUntil: '',
  priority: 100,
  enabled: true,
};

function RuleDialog({ rule, zones, stations, onClose, onSaved }) {
  const [form, setForm] = useState(
    rule
      ? {
          ...emptyRule,
          ...rule,
          ratePercent: (rule.rateBasisPoints / 100).toString(),
          jurisdiction: rule.jurisdiction ?? '',
          zoneId: rule.zoneId ?? '',
          stationId: rule.stationId ?? '',
          validFrom: rule.validFrom ? rule.validFrom.slice(0, 10) : '',
          validUntil: rule.validUntil ? rule.validUntil.slice(0, 10) : '',
        }
      : emptyRule,
  );
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    const payload = {
      name: form.name,
      jurisdiction: form.jurisdiction,
      rateBasisPoints: Math.round(Number(form.ratePercent) * 100),
      mode: form.mode,
      appliesTo: form.appliesTo,
      scope: form.scope,
      zoneId: form.scope === 'ZONE' ? form.zoneId : null,
      stationId: form.scope === 'STATION' ? form.stationId : null,
      validFrom: form.validFrom || null,
      validUntil: form.validUntil || null,
      priority: Number(form.priority),
      enabled: form.enabled,
    };
    if (!Number.isFinite(Number(form.ratePercent)) || form.ratePercent === '') {
      return setError('Enter the rate as a percentage, for example 20 for 20%.');
    }
    try {
      if (rule) await api.patch(`/api/admin/tax-rules/${rule.id}`, payload);
      else await api.post('/api/admin/tax-rules', payload);
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error ?? 'The rule could not be saved.');
    }
  }

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" component="form" onSubmit={handleSubmit}>
      <DialogTitle>{rule ? 'Edit tax rule' : 'Add tax rule'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField label="Name" required value={form.name} onChange={set('name')} helperText="Shown on receipts, for example VAT." />
          <TextField label="Jurisdiction (optional)" value={form.jurisdiction} onChange={set('jurisdiction')} helperText="For example Ontario HST or DE VAT." />
          <TextField label="Rate (%)" required value={form.ratePercent} onChange={set('ratePercent')} inputProps={{ inputMode: 'decimal' }} />
          <TextField select label="Mode" value={form.mode} onChange={set('mode')}
            helperText={form.mode === 'EXCLUSIVE' ? 'Added on top of the price the driver sees.' : 'Already included in the price the driver sees.'}>
            <MenuItem value="EXCLUSIVE">Added on top (exclusive)</MenuItem>
            <MenuItem value="INCLUSIVE">Included in the price (inclusive)</MenuItem>
          </TextField>
          <TextField select label="Applies to" value={form.appliesTo} onChange={set('appliesTo')}>
            <MenuItem value="ALL">Every session</MenuItem>
            <MenuItem value="ENERGY">Sessions priced per kWh</MenuItem>
            <MenuItem value="TIME">Sessions priced per minute</MenuItem>
          </TextField>
          <TextField select label="Where" value={form.scope} onChange={set('scope')}>
            <MenuItem value="SITE">Whole site</MenuItem>
            <MenuItem value="ZONE">One zone</MenuItem>
            <MenuItem value="STATION">One charge point</MenuItem>
          </TextField>
          {form.scope === 'ZONE' && (
            <TextField select label="Zone" value={form.zoneId} onChange={set('zoneId')}>
              {zones.map((z) => <MenuItem key={z.id} value={z.id}>{z.name}</MenuItem>)}
            </TextField>
          )}
          {form.scope === 'STATION' && (
            <TextField select label="Charge point" value={form.stationId} onChange={set('stationId')}>
              {stations.map((s) => <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>)}
            </TextField>
          )}
          <Stack direction="row" spacing={2}>
            <TextField type="date" label="Valid from" InputLabelProps={{ shrink: true }} value={form.validFrom} onChange={set('validFrom')} fullWidth />
            <TextField type="date" label="Valid until" InputLabelProps={{ shrink: true }} value={form.validUntil} onChange={set('validUntil')} fullWidth />
          </Stack>
          <TextField label="Priority" type="number" value={form.priority} onChange={set('priority')} helperText="Lower numbers are applied first." />
          <FormControlLabel control={<Checkbox checked={form.enabled} onChange={set('enabled')} />} label="Enabled" />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="contained">Save</Button>
      </DialogActions>
    </Dialog>
  );
}

function TaxRules({ canManage }) {
  const [rules, setRules] = useState([]);
  const [zones, setZones] = useState([]);
  const [stations, setStations] = useState([]);
  const [editing, setEditing] = useState(null);
  const [preview, setPreview] = useState({ priceCents: 1000, pricingModel: 'ENERGY', stationId: '' });
  const [previewResult, setPreviewResult] = useState(null);
  const [error, setError] = useState('');

  async function load() {
    const { data } = await api.get('/api/admin/tax-rules');
    setRules(data.data);
  }

  useEffect(() => {
    load().catch(() => setError('Tax rules could not be loaded.'));
    api.get('/api/admin/zones', { params: { limit: 200 } }).then(({ data }) => setZones(data.data)).catch(() => {});
    api.get('/api/admin/stations', { params: { limit: 200 } }).then(({ data }) => setStations(data.data)).catch(() => {});
  }, []);

  async function remove(rule) {
    if (!window.confirm(`Delete the tax rule "${rule.name}"? Charges already made keep the tax they were given.`)) return;
    try {
      await api.delete(`/api/admin/tax-rules/${rule.id}`);
      await load();
    } catch (err) {
      setError(err.response?.data?.error ?? 'The rule could not be deleted.');
    }
  }

  async function runPreview() {
    setError('');
    try {
      const { data } = await api.get('/api/admin/tax-rules/preview', {
        params: {
          priceCents: Math.round(Number(preview.priceCents)),
          pricingModel: preview.pricingModel,
          ...(preview.stationId && { stationId: preview.stationId }),
        },
      });
      setPreviewResult(data);
    } catch (err) {
      setError(err.response?.data?.error ?? 'The preview failed.');
    }
  }

  return (
    <Stack spacing={2}>
      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="body2" color="text.secondary">
          Rules combine as follows: inclusive rules come out of the price first, then added rules are charged on the net amount. Rules do not compound on each other.
        </Typography>
        {canManage && <Button variant="contained" onClick={() => setEditing({})}>Add rule</Button>}
      </Stack>
      {rules.length === 0 ? (
        <Typography color="text.secondary">No tax rules. Charges are made without tax until you add one.</Typography>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Priority</TableCell>
              <TableCell>Name</TableCell>
              <TableCell>Rate</TableCell>
              <TableCell>Mode</TableCell>
              <TableCell>Applies to</TableCell>
              <TableCell>Where</TableCell>
              <TableCell>Valid</TableCell>
              <TableCell>Status</TableCell>
              {canManage && <TableCell align="right">Actions</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {rules.map((r) => {
              const where = r.scope === 'SITE' ? 'Whole site'
                : r.scope === 'ZONE' ? `Zone ${zones.find((z) => z.id === r.zoneId)?.name ?? '(removed)'}`
                  : `Charge point ${stations.find((s) => s.id === r.stationId)?.name ?? '(removed)'}`;
              return (
                <TableRow key={r.id}>
                  <TableCell>{r.priority}</TableCell>
                  <TableCell>{r.name}{r.jurisdiction ? ` (${r.jurisdiction})` : ''}</TableCell>
                  <TableCell>{percent(r.rateBasisPoints)}</TableCell>
                  <TableCell>{r.mode === 'INCLUSIVE' ? 'Included' : 'Added'}</TableCell>
                  <TableCell>{{ ALL: 'Every session', ENERGY: 'Per kWh', TIME: 'Per minute' }[r.appliesTo]}</TableCell>
                  <TableCell>{where}</TableCell>
                  <TableCell>{r.validFrom || r.validUntil ? `${when(r.validFrom)} – ${when(r.validUntil)}` : 'Always'}</TableCell>
                  <TableCell>{r.enabled ? 'On' : 'Off'}</TableCell>
                  {canManage && (
                    <TableCell align="right">
                      <Button size="small" onClick={() => setEditing(r)}>Edit</Button>
                      <Button size="small" color="error" onClick={() => remove(r)}>Delete</Button>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <Paper sx={{ p: 2 }}>
        <Typography variant="subtitle1" fontWeight={600} gutterBottom>Check a price</Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="center">
          <TextField label="Price before tax (cents)" type="number" size="small" value={preview.priceCents}
            onChange={(e) => setPreview({ ...preview, priceCents: e.target.value })} />
          <TextField select label="Priced per" size="small" value={preview.pricingModel} sx={{ minWidth: 140 }}
            onChange={(e) => setPreview({ ...preview, pricingModel: e.target.value })}>
            <MenuItem value="ENERGY">kWh</MenuItem>
            <MenuItem value="TIME">Minute</MenuItem>
          </TextField>
          <TextField select label="Charge point" size="small" value={preview.stationId} sx={{ minWidth: 200 }}
            onChange={(e) => setPreview({ ...preview, stationId: e.target.value })}>
            <MenuItem value="">Whole site</MenuItem>
            {stations.map((s) => <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>)}
          </TextField>
          <Button variant="outlined" onClick={runPreview}>Check</Button>
        </Stack>
        {previewResult && (
          <Typography sx={{ mt: 2 }}>
            Before tax {money(previewResult.netCents)}, tax {money(previewResult.taxCents)}, driver pays {money(previewResult.grossCents)}.
            {previewResult.lines.length === 0 && ' No rule applies.'}
          </Typography>
        )}
      </Paper>

      {editing && (
        <RuleDialog
          rule={editing.id ? editing : null}
          zones={zones}
          stations={stations}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}
    </Stack>
  );
}

function Invoices({ canManage }) {
  const [invoices, setInvoices] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [available, setAvailable] = useState([]);
  const [picked, setPicked] = useState([]);
  const [customerId, setCustomerId] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function load() {
    const [inv, avail, cust] = await Promise.all([
      api.get('/api/admin/billing/invoices'),
      api.get('/api/admin/billing/uninvoiced-charges'),
      api.get('/api/admin/billing/customers'),
    ]);
    setInvoices(inv.data.data);
    setAvailable(avail.data.data);
    setCustomers(cust.data.data);
  }

  useEffect(() => {
    load().catch(() => setError('Invoices could not be loaded.'));
  }, []);

  async function run(action, success) {
    setError('');
    setMessage('');
    try {
      await action();
      setMessage(success);
      await load();
    } catch (err) {
      setError(err.response?.data?.error ?? 'The request failed.');
    }
  }

  const pickedTotal = available.filter((c) => picked.includes(c.id)).reduce((t, c) => t + c.totalCents, 0);

  return (
    <Stack spacing={3}>
      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
      {message && <Alert severity="success" onClose={() => setMessage('')}>{message}</Alert>}

      {canManage && (
        <Paper sx={{ p: 2 }}>
          <Typography variant="subtitle1" fontWeight={600} gutterBottom>New invoice</Typography>
          {customers.length === 0 ? (
            <Typography color="text.secondary">Add a customer on the Customers tab first.</Typography>
          ) : available.length === 0 ? (
            <Typography color="text.secondary">No paid charges are waiting to be invoiced.</Typography>
          ) : (
            <Stack spacing={2}>
              <TextField select label="Customer" size="small" value={customerId} onChange={(e) => setCustomerId(e.target.value)} sx={{ maxWidth: 360 }}>
                {customers.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
              </TextField>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell padding="checkbox" />
                    <TableCell>Date</TableCell>
                    <TableCell>Charge point</TableCell>
                    <TableCell align="right">Before tax</TableCell>
                    <TableCell align="right">Tax</TableCell>
                    <TableCell align="right">Total</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {available.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell padding="checkbox">
                        <Checkbox
                          checked={picked.includes(c.id)}
                          onChange={(e) => setPicked(e.target.checked ? [...picked, c.id] : picked.filter((id) => id !== c.id))}
                        />
                      </TableCell>
                      <TableCell>{when(c.createdAt)}</TableCell>
                      <TableCell>{c.stationName ?? '—'}</TableCell>
                      <TableCell align="right">{money(c.netCents, c.currency)}</TableCell>
                      <TableCell align="right">{money(c.taxCents, c.currency)}</TableCell>
                      <TableCell align="right">{money(c.totalCents, c.currency)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Stack direction="row" spacing={2} alignItems="center">
                <Typography>{picked.length} selected, {money(pickedTotal)}</Typography>
                <Button
                  variant="contained"
                  disabled={!customerId || picked.length === 0}
                  onClick={() =>
                    run(async () => {
                      await api.post('/api/admin/billing/invoices', { customerId, chargeIds: picked });
                      setPicked([]);
                    }, 'Invoice issued.')
                  }
                >
                  Issue invoice
                </Button>
              </Stack>
            </Stack>
          )}
        </Paper>
      )}

      <Paper sx={{ p: 2 }}>
        <Typography variant="subtitle1" fontWeight={600} gutterBottom>Invoices and credit notes</Typography>
        {invoices.length === 0 ? (
          <Typography color="text.secondary">None yet.</Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Number</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Customer</TableCell>
                <TableCell>Issued</TableCell>
                <TableCell>Due</TableCell>
                <TableCell align="right">Total</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {invoices.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell>{inv.number}</TableCell>
                  <TableCell>{inv.kind === 'CREDIT_NOTE' ? 'Credit note' : 'Invoice'}</TableCell>
                  <TableCell>{inv.customerName}</TableCell>
                  <TableCell>{when(inv.issuedAt)}</TableCell>
                  <TableCell>{inv.kind === 'INVOICE' ? when(inv.dueAt) : '—'}</TableCell>
                  <TableCell align="right">{money(inv.totalCents, inv.currency)}</TableCell>
                  <TableCell>{inv.kind === 'INVOICE' ? (inv.status === 'PAID' ? 'Paid' : 'Unpaid') : '—'}</TableCell>
                  <TableCell align="right">
                    <Button size="small" onClick={() => openDocument(`/api/admin/billing/invoices/${inv.id}/document`)}>View</Button>
                    {canManage && inv.kind === 'INVOICE' && inv.status !== 'PAID' && (
                      <Button size="small" onClick={() => run(() => api.post(`/api/admin/billing/invoices/${inv.id}/mark-paid`), 'Marked paid.')}>Mark paid</Button>
                    )}
                    {canManage && inv.kind === 'INVOICE' && (
                      <Button size="small" color="warning" onClick={() => {
                        if (window.confirm(`Issue a credit note for ${inv.number}?`)) {
                          run(() => api.post(`/api/admin/billing/invoices/${inv.id}/credit-note`), 'Credit note issued.');
                        }
                      }}>Credit</Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Paper>
    </Stack>
  );
}

function Receipts() {
  const [receipts, setReceipts] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => {
    api.get('/api/admin/billing/receipts').then(({ data }) => setReceipts(data.data)).catch(() => setError('Receipts could not be loaded.'));
  }, []);
  return (
    <Paper sx={{ p: 2 }}>
      {error && <Alert severity="error">{error}</Alert>}
      <Typography variant="body2" color="text.secondary" gutterBottom>
        A receipt is issued automatically when a charge is paid. Each receipt is also served at {'/api/receipts/<charge token>'}, the same token as the payment link.
      </Typography>
      {receipts.length === 0 ? (
        <Typography color="text.secondary">No receipts yet.</Typography>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Number</TableCell>
              <TableCell>Issued</TableCell>
              <TableCell align="right">Before tax</TableCell>
              <TableCell align="right">Tax</TableCell>
              <TableCell align="right">Total</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {receipts.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{r.number}</TableCell>
                <TableCell>{when(r.issuedAt)}</TableCell>
                <TableCell align="right">{money(r.netCents, r.currency)}</TableCell>
                <TableCell align="right">{money(r.taxCents, r.currency)}</TableCell>
                <TableCell align="right">{money(r.totalCents, r.currency)}</TableCell>
                <TableCell align="right">
                  <Button size="small" onClick={() => openDocument(`/api/admin/billing/receipts/${r.id}/document`)}>View</Button>
                  <Button
                    size="small"
                    color="warning"
                    onClick={async () => {
                      const reason = window.prompt('Why is this charge being reversed? The reason is kept on the charge.');
                      if (!reason) return;
                      try {
                        const { data } = await api.post(`/api/admin/billing/charges/${r.chargeId}/reverse`, { reason });
                        window.alert(data.message);
                      } catch (err) {
                        window.alert(err.response?.data?.error ?? 'The charge could not be reversed.');
                      }
                    }}
                  >
                    Reverse
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Paper>
  );
}

function Customers({ canManage }) {
  const [customers, setCustomers] = useState([]);
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');

  async function load() {
    const { data } = await api.get('/api/admin/billing/customers');
    setCustomers(data.data);
  }
  useEffect(() => {
    load().catch(() => setError('Customers could not be loaded.'));
  }, []);

  async function save(e) {
    e.preventDefault();
    setError('');
    try {
      if (form.id) await api.patch(`/api/admin/billing/customers/${form.id}`, form);
      else await api.post('/api/admin/billing/customers', form);
      setForm(null);
      await load();
    } catch (err) {
      setError(err.response?.data?.error ?? 'The customer could not be saved.');
    }
  }

  async function remove(c) {
    if (!window.confirm(`Delete ${c.name}?`)) return;
    try {
      await api.delete(`/api/admin/billing/customers/${c.id}`);
      await load();
    } catch (err) {
      setError(err.response?.data?.error ?? 'The customer could not be deleted.');
    }
  }

  return (
    <Stack spacing={2}>
      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
      {canManage && <Button variant="contained" sx={{ alignSelf: 'flex-start' }} onClick={() => setForm({ name: '', taxId: '', email: '', address: '', notes: '' })}>Add customer</Button>}
      {customers.length === 0 ? (
        <Typography color="text.secondary">No customers. Add a business that pays for charging to invoice it.</Typography>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Tax ID</TableCell>
              <TableCell>E-mail</TableCell>
              {canManage && <TableCell align="right">Actions</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {customers.map((c) => (
              <TableRow key={c.id}>
                <TableCell>{c.name}</TableCell>
                <TableCell>{c.taxId ?? '—'}</TableCell>
                <TableCell>{c.email ?? '—'}</TableCell>
                {canManage && (
                  <TableCell align="right">
                    <Button size="small" onClick={() => setForm(c)}>Edit</Button>
                    <Button size="small" color="error" onClick={() => remove(c)}>Delete</Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {form && (
        <Dialog open onClose={() => setForm(null)} fullWidth maxWidth="sm" component="form" onSubmit={save}>
          <DialogTitle>{form.id ? 'Edit customer' : 'Add customer'}</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 1 }}>
              <TextField label="Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <TextField label="Tax ID" value={form.taxId ?? ''} onChange={(e) => setForm({ ...form, taxId: e.target.value })} />
              <TextField label="Invoice e-mail" value={form.email ?? ''} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              <TextField label="Address" multiline value={form.address ?? ''} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              <TextField label="Notes" multiline value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              <FormControlLabel
                control={<Checkbox checked={Boolean(form.taxExempt)} onChange={(e) => setForm({ ...form, taxExempt: e.target.checked })} />}
                label="Tax exempt (invoices carry no tax)"
              />
              {form.taxExempt && (
                <TextField label="Exemption reference" value={form.exemptionReference ?? ''} onChange={(e) => setForm({ ...form, exemptionReference: e.target.value })} helperText="Printed on invoices, for example the certificate number." />
              )}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setForm(null)}>Cancel</Button>
            <Button type="submit" variant="contained">Save</Button>
          </DialogActions>
        </Dialog>
      )}
    </Stack>
  );
}

function BusinessDetails({ canManage }) {
  const [form, setForm] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/api/admin/billing/settings').then(({ data }) => setForm(data)).catch(() => setError('Settings could not be loaded.'));
  }, []);

  async function save(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      const { data } = await api.put('/api/admin/billing/settings', form);
      setForm(data);
      setMessage('Saved. New documents use these details.');
    } catch (err) {
      setError(err.response?.data?.error ?? 'The details could not be saved.');
    }
  }

  if (!form) return error ? <Alert severity="error">{error}</Alert> : null;
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  return (
    <Paper sx={{ p: 2 }} component="form" onSubmit={save}>
      <Stack spacing={2} sx={{ maxWidth: 560 }}>
        {error && <Alert severity="error">{error}</Alert>}
        {message && <Alert severity="success">{message}</Alert>}
        <Typography variant="body2" color="text.secondary">
          These details appear on every receipt and invoice. Documents already issued keep the details they were issued with.
        </Typography>
        <TextField label="Legal name" value={form.legalName ?? ''} onChange={set('legalName')} helperText="Leave blank to use the site name." />
        <TextField label="Tax ID (VAT number)" value={form.taxId ?? ''} onChange={set('taxId')} />
        <TextField label="Address" multiline value={form.address ?? ''} onChange={set('address')} />
        <Stack direction="row" spacing={2}>
          <TextField label="Invoice number prefix" value={form.invoicePrefix} onChange={set('invoicePrefix')} disabled={!canManage} fullWidth />
          <TextField label="Receipt number prefix" value={form.receiptPrefix} onChange={set('receiptPrefix')} disabled={!canManage} fullWidth />
        </Stack>
        <TextField label="Payment terms (days)" type="number" value={form.paymentTermsDays} onChange={set('paymentTermsDays')} disabled={!canManage} />
        <TextField label="Footer text" multiline value={form.footerText ?? ''} onChange={set('footerText')} disabled={!canManage} helperText="For example company registration number." />
        <Typography variant="subtitle2" fontWeight={600}>E-mail</Typography>
        {!form.emailAvailable && (
          <Typography variant="body2" color="text.secondary">
            E-mail is not set up for this site yet. Set it up under E-mail server to send receipts and invoices by e-mail.
          </Typography>
        )}
        <FormControlLabel
          control={<Checkbox checked={Boolean(form.emailReceipts)} disabled={!canManage || (!form.emailAvailable && !form.emailReceipts)} onChange={(e) => setForm({ ...form, emailReceipts: e.target.checked })} />}
          label="E-mail receipts to drivers who gave an e-mail address"
        />
        <FormControlLabel
          control={<Checkbox checked={Boolean(form.emailInvoices)} disabled={!canManage || (!form.emailAvailable && !form.emailInvoices)} onChange={(e) => setForm({ ...form, emailInvoices: e.target.checked })} />}
          label="E-mail invoices to the customer's invoice address"
        />
        {canManage && <Button type="submit" variant="contained" sx={{ alignSelf: 'flex-start' }}>Save details</Button>}
      </Stack>
    </Paper>
  );
}

const TABS = ['Tax rules', 'Invoices', 'Receipts', 'Customers', 'Business details'];

export function AdminBillingPage() {
  const { can } = useAuth();
  const canManage = can('payments.manage');
  const [tab, setTab] = useState(0);
  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Stack spacing={2}>
        <Typography variant="h5" fontWeight={600}>Billing</Typography>
        <Tabs value={tab} onChange={(_e, v) => setTab(v)} variant="scrollable" allowScrollButtonsMobile>
          {TABS.map((t) => <Tab key={t} label={t} />)}
        </Tabs>
        {tab === 0 && <TaxRules canManage={canManage} />}
        {tab === 1 && <Invoices canManage={canManage} />}
        {tab === 2 && <Receipts />}
        {tab === 3 && <Customers canManage={canManage} />}
        {tab === 4 && <BusinessDetails canManage={canManage} />}
      </Stack>
    </Container>
  );
}
