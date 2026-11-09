import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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

// Firmware images and diagnostics logs kept on the server's disk. Reads need stations.view;
// uploading, editing and deleting need firmware.manage (the buttons hide when it is missing).

function formatBytes(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatWhen(value) {
  return value ? new Date(value).toLocaleString() : '';
}

// Downloads a file through the authenticated API, since a plain link would not send the sign-in token.
async function saveFile(url, fallbackName) {
  const { data, headers } = await api.get(url, { responseType: 'blob' });
  const disposition = headers['content-disposition'] ?? '';
  const match = /filename="?([^";]+)"?/.exec(disposition);
  const href = URL.createObjectURL(data);
  const link = document.createElement('a');
  link.href = href;
  link.download = match?.[1] ?? fallbackName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}

const emptyUpload = { name: '', version: '', vendor: '', model: '', notes: '', file: null };

function UploadDialog({ onClose, onSaved }) {
  const [form, setForm] = useState(emptyUpload);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!form.file) return setError('Choose a firmware file to upload.');
    setSubmitting(true);
    try {
      await api.post('/api/admin/firmware', form.file, {
        params: {
          name: form.name,
          version: form.version,
          vendor: form.vendor,
          model: form.model,
          notes: form.notes,
        },
        headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': form.file.name },
        maxBodyLength: Infinity,
      });
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error ?? 'The file could not be uploaded.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" component="form" onSubmit={handleSubmit}>
      <DialogTitle>Upload firmware</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField label="Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <TextField label="Version" required value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} />
          <TextField label="Vendor (optional)" value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} />
          <TextField label="Model (optional)" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
          <TextField label="Notes (optional)" multiline value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          <Button variant="outlined" component="label">
            {form.file ? form.file.name : 'Choose file'}
            <input type="file" hidden onChange={(e) => setForm({ ...form, file: e.target.files?.[0] ?? null })} />
          </Button>
          <Typography variant="body2" color="text.secondary">
            Up to 200 MB. Use the file the charge point's vendor supplies for this model.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="contained" disabled={submitting}>
          {submitting ? 'Uploading…' : 'Upload'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function EditDialog({ pkg, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: pkg.name,
    version: pkg.version,
    vendor: pkg.vendor ?? '',
    model: pkg.model ?? '',
    notes: pkg.notes ?? '',
  });
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    try {
      await api.patch(`/api/admin/firmware/${pkg.id}`, form);
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error ?? 'The change could not be saved.');
    }
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" component="form" onSubmit={handleSubmit}>
      <DialogTitle>Edit firmware</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <Typography variant="body2" color="text.secondary">
            File: {pkg.fileName} ({formatBytes(pkg.sizeBytes)}). To replace the file, upload a new firmware and delete this one.
          </Typography>
          <TextField label="Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <TextField label="Version" required value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} />
          <TextField label="Vendor" value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} />
          <TextField label="Model" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
          <TextField label="Notes" multiline value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="contained">Save</Button>
      </DialogActions>
    </Dialog>
  );
}

const STATUS_LABELS = {
  REQUESTED: 'Waiting for upload',
  UPLOADED: 'Uploaded',
  FAILED: 'Failed',
};

export function AdminFirmwarePage() {
  const [packages, setPackages] = useState([]);
  const [logs, setLogs] = useState([]);
  const [stations, setStations] = useState([]);
  const [stationFilter, setStationFilter] = useState('');
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function loadPackages() {
    const { data } = await api.get('/api/admin/firmware');
    setPackages(data.data);
  }

  async function loadLogs() {
    const query = stationFilter ? `?stationId=${encodeURIComponent(stationFilter)}` : '';
    const { data } = await api.get(`/api/admin/firmware/diagnostics${query}`);
    setLogs(data.data);
  }

  useEffect(() => {
    loadPackages().catch(() => setError('Firmware could not be loaded.'));
    api.get('/api/admin/stations', { params: { limit: 200 } }).then(({ data }) => setStations(data.data)).catch(() => {});
  }, []);

  useEffect(() => {
    loadLogs().catch(() => setError('Diagnostics logs could not be loaded.'));
  }, [stationFilter]);

  async function run(action, success) {
    setError('');
    setMessage('');
    try {
      await action();
      setMessage(success);
    } catch (err) {
      setError(err.response?.data?.error ?? 'The request failed.');
    }
  }

  async function removeFirmware(pkg) {
    if (!window.confirm(`Delete firmware ${pkg.version} (${pkg.name})? Charge points that have not yet downloaded it will fail.`)) return;
    await run(async () => {
      await api.delete(`/api/admin/firmware/${pkg.id}`);
      await loadPackages();
    }, 'Firmware deleted.');
  }

  async function removeLog(log) {
    if (!window.confirm('Delete this diagnostics log?')) return;
    await run(async () => {
      await api.delete(`/api/admin/firmware/diagnostics/${log.id}`);
      await loadLogs();
    }, 'Diagnostics log deleted.');
  }

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Stack spacing={3}>
        <Typography variant="h5" fontWeight={600}>Firmware and diagnostics</Typography>
        <Typography variant="body2" color="text.secondary">
          Firmware images and the diagnostics logs charge points send are kept on this server's disk. Turn on
          "Firmware updates and diagnostics logs" for a charge point before sending it either one.
        </Typography>
        {message && <Alert severity="success" onClose={() => setMessage('')}>{message}</Alert>}
        {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}

        <Paper sx={{ p: 2 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
            <Typography variant="h6">Firmware images</Typography>
            <Button variant="contained" onClick={() => setUploading(true)}>Upload firmware</Button>
          </Stack>
          {packages.length === 0 ? (
            <Typography color="text.secondary">No firmware uploaded yet.</Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Version</TableCell>
                  <TableCell>Vendor / model</TableCell>
                  <TableCell>File</TableCell>
                  <TableCell>Size</TableCell>
                  <TableCell>SHA-256</TableCell>
                  <TableCell>Uploaded</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {packages.map((pkg) => (
                  <TableRow key={pkg.id}>
                    <TableCell>{pkg.name}</TableCell>
                    <TableCell>{pkg.version}</TableCell>
                    <TableCell>{[pkg.vendor, pkg.model].filter(Boolean).join(' / ') || '—'}</TableCell>
                    <TableCell>{pkg.fileName}</TableCell>
                    <TableCell>{formatBytes(pkg.sizeBytes)}</TableCell>
                    <TableCell sx={{ fontFamily: 'monospace' }} title={pkg.sha256}>{pkg.sha256.slice(0, 12)}…</TableCell>
                    <TableCell>{formatWhen(pkg.createdAt)}</TableCell>
                    <TableCell align="right">
                      <Button size="small" onClick={() => run(() => saveFile(`/api/admin/firmware/${pkg.id}/download`, pkg.fileName), 'Download started.')}>
                        Download
                      </Button>
                      <Button size="small" onClick={() => setEditing(pkg)}>Edit</Button>
                      <Button size="small" color="error" onClick={() => removeFirmware(pkg)}>Delete</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Paper>

        <Paper sx={{ p: 2 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
            <Typography variant="h6">Diagnostics logs</Typography>
            <TextField
              select
              size="small"
              label="Charge point"
              value={stationFilter}
              onChange={(e) => setStationFilter(e.target.value)}
              sx={{ minWidth: 220 }}
            >
              <MenuItem value="">All charge points</MenuItem>
              {stations.map((s) => (
                <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>
              ))}
            </TextField>
          </Stack>
          {logs.length === 0 ? (
            <Typography color="text.secondary">No diagnostics logs yet. Ask a charge point for one from its page.</Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Requested</TableCell>
                  <TableCell>Charge point</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Uploaded</TableCell>
                  <TableCell>Size</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell>{formatWhen(log.requestedAt)}</TableCell>
                    <TableCell>{log.stationName ?? '—'}</TableCell>
                    <TableCell>{STATUS_LABELS[log.status] ?? log.status}</TableCell>
                    <TableCell>{formatWhen(log.uploadedAt)}</TableCell>
                    <TableCell>{formatBytes(log.sizeBytes)}</TableCell>
                    <TableCell align="right">
                      {log.hasFile && (
                        <Button size="small" onClick={() => run(() => saveFile(`/api/admin/firmware/diagnostics/${log.id}/download`, log.fileName ?? 'diagnostics.log'), 'Download started.')}>
                          Download
                        </Button>
                      )}
                      <Button size="small" color="error" onClick={() => removeLog(log)}>Delete</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Paper>
      </Stack>

      {uploading && (
        <UploadDialog
          onClose={() => setUploading(false)}
          onSaved={async () => {
            setUploading(false);
            setMessage('Firmware uploaded.');
            await loadPackages();
          }}
        />
      )}
      {editing && (
        <EditDialog
          pkg={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            setMessage('Firmware saved.');
            await loadPackages();
          }}
        />
      )}
    </Container>
  );
}
