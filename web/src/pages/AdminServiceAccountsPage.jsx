import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  FormGroup,
  IconButton,
  Link,
  Paper,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import VpnKeyIcon from '@mui/icons-material/VpnKey';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { Link as RouterLink } from 'react-router-dom';
import { api } from '../api/client.js';
import { usePagedList } from '../api/paged.js';
import { LoadMore } from '../components/LoadMore.jsx';
import { useAuth } from '../context/AuthContext.jsx';

// Service accounts are non-human principals for the REST API. Their permissions
// are the API permissions ("api.*"), grouped the way the role editor groups them.
const isApiPermission = (perm) => perm.key.startsWith('api.');
const API_DOCS_URL = `${import.meta.env.VITE_API_URL ?? 'http://localhost:4000'}/api/docs`;

function keyStatusColor(status) {
  return status === 'ACTIVE' ? 'success' : 'default';
}

function formatWhen(value) {
  return value ? new Date(value).toLocaleString() : '—';
}

// Checkboxes for the API permissions. A person can only grant what they hold, so
// the rest are shown but disabled.
function PermissionChecklist({ catalog, callerPermissions, selected, onToggle }) {
  const groups = catalog.filter(isApiPermission).reduce((acc, perm) => {
    (acc[perm.group] ??= []).push(perm);
    return acc;
  }, {});

  return (
    <Box>
      {Object.entries(groups).map(([group, perms]) => (
        <Box key={group} sx={{ mb: 1 }}>
          <Typography variant="subtitle2">{group}</Typography>
          <FormGroup>
            {perms.map((perm) => {
              const allowed = callerPermissions.includes(perm.key) || selected.has(perm.key);
              return (
                <FormControlLabel
                  key={perm.key}
                  label={perm.label}
                  disabled={!callerPermissions.includes(perm.key)}
                  control={
                    <Checkbox size="small" checked={selected.has(perm.key)} onChange={() => onToggle(perm.key)} />
                  }
                  sx={{ opacity: allowed ? 1 : 0.6 }}
                />
              );
            })}
          </FormGroup>
        </Box>
      ))}
    </Box>
  );
}

function AccountFormDialog({ account, catalog, callerPermissions, onClose, onSaved }) {
  const isEdit = Boolean(account);
  const [name, setName] = useState(account?.name ?? '');
  const [description, setDescription] = useState(account?.description ?? '');
  const [disabled, setDisabled] = useState(account?.disabled ?? false);
  const [selected, setSelected] = useState(new Set(account?.permissions ?? []));
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function toggle(key) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    const body = { description, permissions: [...selected] };
    try {
      if (isEdit) {
        await api.put(`/api/admin/service-accounts/${account.id}`, { ...body, disabled });
      } else {
        await api.post('/api/admin/service-accounts', { ...body, name });
      }
      onSaved();
    } catch (err) {
      const missing = err.response?.data?.missing;
      setError(
        missing?.length
          ? `You cannot grant: ${missing.join(', ')}`
          : (err.response?.data?.error ?? 'Could not save the service account.'),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{isEdit ? `Edit ${account.name}` : 'Add service account'}</DialogTitle>
      <form onSubmit={handleSubmit}>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              label="Name"
              helperText="What this account is for, such as Parking dashboard. Letters, numbers, spaces, dots, hyphens, and underscores."
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              disabled={isEdit}
              autoFocus={!isEdit}
              fullWidth
            />
            <TextField
              label="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              inputProps={{ maxLength: 200 }}
              fullWidth
            />
            {isEdit && (
              <FormControlLabel
                control={<Switch checked={disabled} onChange={(e) => setDisabled(e.target.checked)} />}
                label="Disabled: every key stops working until it is turned back on"
              />
            )}
            <Box>
              <Typography variant="subtitle1" gutterBottom>
                Permissions
              </Typography>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Read permissions let the account read; write and control permissions let it change things. Only
                permissions you hold can be ticked.
              </Typography>
              <PermissionChecklist
                catalog={catalog}
                callerPermissions={callerPermissions}
                selected={selected}
                onToggle={toggle}
              />
            </Box>
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

// Shows a new key once. It cannot be retrieved later.
function NewKeyDialog({ plainKey, onClose }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(plainKey);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Copy the new API key</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Alert severity="warning">
            This is the only time the key is shown. Copy it now and store it somewhere safe. If you lose it, create a new
            key and revoke this one.
          </Alert>
          <TextField
            value={plainKey}
            fullWidth
            InputProps={{ readOnly: true, sx: { fontFamily: 'monospace' } }}
            onFocus={(e) => e.target.select()}
          />
          {copied && <Typography variant="body2">Copied.</Typography>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button startIcon={<ContentCopyIcon />} onClick={copy}>
          Copy
        </Button>
        <Button variant="contained" onClick={onClose}>
          I have copied it
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function KeysDialog({ account, canManage, onClose, onChanged }) {
  const [name, setName] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [newKey, setNewKey] = useState(null);

  async function createKey(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const { data } = await api.post(`/api/admin/service-accounts/${account.id}/keys`, {
        name,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      });
      setNewKey(data.plainKey);
      setName('');
      setExpiresAt('');
      onChanged();
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not create the key.');
    } finally {
      setSubmitting(false);
    }
  }

  async function revoke(keyId) {
    setError('');
    try {
      await api.delete(`/api/admin/service-accounts/${account.id}/keys/${keyId}`);
      onChanged();
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not revoke the key.');
    }
  }

  const keys = account.keys ?? [];

  return (
    <>
      <Dialog open onClose={onClose} fullWidth maxWidth="md">
        <DialogTitle>API keys for {account.name}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            {account.disabled && <Alert severity="info">This account is disabled, so none of its keys work.</Alert>}
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Key starts with</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Created</TableCell>
                  <TableCell>Last used</TableCell>
                  <TableCell>Expires</TableCell>
                  <TableCell align="right" />
                </TableRow>
              </TableHead>
              <TableBody>
                {keys.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7}>
                      <Typography variant="body2" color="text.secondary">
                        No keys yet.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
                {keys.map((key) => (
                  <TableRow key={key.id}>
                    <TableCell>{key.name}</TableCell>
                    <TableCell sx={{ fontFamily: 'monospace' }}>pgk_{key.prefix}…</TableCell>
                    <TableCell>
                      <Chip size="small" label={key.status.toLowerCase()} color={keyStatusColor(key.status)} />
                    </TableCell>
                    <TableCell>{formatWhen(key.createdAt)}</TableCell>
                    <TableCell>{formatWhen(key.lastUsedAt)}</TableCell>
                    <TableCell>{key.expiresAt ? formatWhen(key.expiresAt) : 'Never'}</TableCell>
                    <TableCell align="right">
                      {canManage && key.status === 'ACTIVE' && (
                        <Button size="small" color="error" onClick={() => revoke(key.id)}>
                          Revoke
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {canManage && (
              <Box component="form" onSubmit={createKey}>
                <Typography variant="subtitle1" gutterBottom>
                  Create a key
                </Typography>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'flex-start' }}>
                  <TextField
                    label="Key name"
                    helperText="Where it is used, such as Parking dashboard server"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    inputProps={{ maxLength: 60 }}
                    sx={{ flex: 1 }}
                  />
                  <TextField
                    label="Expires (optional)"
                    type="datetime-local"
                    value={expiresAt}
                    onChange={(e) => setExpiresAt(e.target.value)}
                    InputLabelProps={{ shrink: true }}
                    sx={{ flex: 1 }}
                  />
                  <Button type="submit" variant="contained" startIcon={<VpnKeyIcon />} disabled={submitting} sx={{ mt: 1 }}>
                    Create key
                  </Button>
                </Stack>
              </Box>
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose}>Close</Button>
        </DialogActions>
      </Dialog>
      {newKey && <NewKeyDialog plainKey={newKey} onClose={() => setNewKey(null)} />}
    </>
  );
}

export function AdminServiceAccountsPage() {
  const { can } = useAuth();
  const canManage = can('serviceAccounts.manage');
  const accountList = usePagedList('/api/admin/service-accounts');
  const accounts = accountList.items;
  const [catalog, setCatalog] = useState([]);
  const [callerPermissions, setCallerPermissions] = useState([]);
  const [editing, setEditing] = useState(null); // null, 'new', or an account
  const [keysFor, setKeysFor] = useState(null); // account id whose keys are open
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [error, setError] = useState('');

  async function refresh() {
    const [, { data: roleData }] = await Promise.all([accountList.reload(), api.get('/api/admin/roles')]);
    setCatalog(roleData.permissions);
    setCallerPermissions(roleData.callerPermissions);
  }

  useEffect(() => {
    refresh().catch(() => setError('Could not load service accounts.'));
  }, []);

  async function confirmDelete() {
    try {
      await api.delete(`/api/admin/service-accounts/${deleteTarget.id}`);
      setDeleteTarget(null);
      await refresh();
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not delete the service account.');
    }
  }

  const openAccount = keysFor ? accounts.find((a) => a.id === keysFor) : null;

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }} spacing={2}>
        <Box>
          <Typography variant="h5">API access</Typography>
          <Typography variant="body2" color="text.secondary">
            Service accounts let other systems use the REST API. Each account has its own permissions and keys.{' '}
            <Link href={API_DOCS_URL} target="_blank" rel="noopener">
              API reference
            </Link>{' '}
            ·{' '}
            <Link component={RouterLink} to="/help/api-access">
              Help
            </Link>
          </Typography>
        </Box>
        {canManage && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing('new')}>
            Add service account
          </Button>
        )}
      </Stack>

      {error && (
        <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Paper variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Permissions</TableCell>
              <TableCell>Keys</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {accounts.length === 0 && (
              <TableRow>
                <TableCell colSpan={5}>
                  <Typography variant="body2" color="text.secondary">
                    No service accounts yet.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {accounts.map((account) => {
              const activeKeys = account.keys.filter((k) => k.status === 'ACTIVE').length;
              return (
                <TableRow key={account.id}>
                  <TableCell>
                    <Typography variant="body2" fontWeight={500}>
                      {account.name}
                    </Typography>
                    {account.description && (
                      <Typography variant="caption" color="text.secondary">
                        {account.description}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    {account.permissions.length === 0 ? (
                      <Typography variant="body2" color="text.secondary">
                        None
                      </Typography>
                    ) : (
                      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                        {account.permissions.map((p) => (
                          <Chip key={p} size="small" label={p.replace(/^api\./, '')} variant="outlined" />
                        ))}
                      </Stack>
                    )}
                  </TableCell>
                  <TableCell>{activeKeys} active</TableCell>
                  <TableCell>
                    <Chip size="small" label={account.disabled ? 'Disabled' : 'Enabled'} color={account.disabled ? 'default' : 'success'} />
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title="API keys">
                      <IconButton aria-label={`API keys for ${account.name}`} onClick={() => setKeysFor(account.id)}>
                        <VpnKeyIcon />
                      </IconButton>
                    </Tooltip>
                    {canManage && (
                      <>
                        <Tooltip title="Edit">
                          <IconButton aria-label={`Edit ${account.name}`} onClick={() => setEditing(account)}>
                            <EditIcon />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Delete">
                          <IconButton aria-label={`Delete ${account.name}`} onClick={() => setDeleteTarget(account)}>
                            <DeleteIcon />
                          </IconButton>
                        </Tooltip>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <LoadMore hasMore={accountList.hasMore} loading={accountList.loading} onLoadMore={accountList.loadMore} />
      </Paper>

      {editing && (
        <AccountFormDialog
          account={editing === 'new' ? null : editing}
          catalog={catalog}
          callerPermissions={callerPermissions}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refresh();
          }}
        />
      )}

      {openAccount && (
        <KeysDialog
          account={openAccount}
          canManage={canManage}
          onClose={() => setKeysFor(null)}
          onChanged={refresh}
        />
      )}

      {deleteTarget && (
        <Dialog open onClose={() => setDeleteTarget(null)}>
          <DialogTitle>Delete {deleteTarget.name}?</DialogTitle>
          <DialogContent>
            <Typography>
              Its API keys are deleted with it, and every system using them stops working. This cannot be undone.
            </Typography>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button color="error" variant="contained" onClick={confirmDelete}>
              Delete
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Container>
  );
}
