import { useEffect, useState } from 'react';
import { Box, FormControl } from '@mui/material';
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
  Switch,
  FormControlLabel,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Alert,
  Tooltip,
  MenuItem,
  Checkbox,
  FormGroup,
  FormLabel,
  Divider,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import LockResetIcon from '@mui/icons-material/LockReset';
import EditIcon from '@mui/icons-material/Edit';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useSettings } from '../context/SettingsContext.jsx';

// Role options come from the server: the built-in roles plus any custom roles.
function CreateUserDialog({ roleOptions, onClose, onSaved }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('VIEWER');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await api.post('/api/admin/users', { email, password: password || undefined, role });
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not create the user.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Add user</DialogTitle>
      <form onSubmit={handleSubmit}>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              fullWidth
            />
            <TextField
              label="Password"
              type="password"
              helperText="Leave blank for an SSO-only account (sign in via SAML instead)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              fullWidth
            />
            <TextField
              select
              label="Role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              helperText={roleOptions.find((o) => o.value === role)?.help}
              fullWidth
            >
              {roleOptions.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

// Create or edit a custom role. Permissions you don't hold are shown but can't be ticked.
function RoleDialog({ role, catalog, callerPermissions, onClose, onSaved }) {
  const editing = Boolean(role);
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [selected, setSelected] = useState(new Set(role?.permissions ?? []));
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const groups = catalog.reduce((acc, perm) => {
    (acc[perm.group] ??= []).push(perm);
    return acc;
  }, {});

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
    const permissions = [...selected];
    try {
      if (editing) {
        await api.patch(`/api/admin/roles/${encodeURIComponent(role.name)}`, { description, permissions });
      } else {
        await api.post('/api/admin/roles', { name, description, permissions });
      }
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not save the role.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{editing ? `Edit role: ${role.name}` : 'Create role'}</DialogTitle>
      <form onSubmit={handleSubmit}>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              label="Role name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={editing}
              required
              helperText={editing ? 'Names can\'t be changed. Create a new role to rename.' : 'For example: Electrician or Read-only.'}
              fullWidth
            />
            <TextField
              label="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              fullWidth
            />
            <FormControl component="fieldset" variant="standard">
              <FormLabel component="legend">Permissions</FormLabel>
              <Typography variant="caption" color="text.secondary" sx={{ mb: 1 }}>
                You can only grant permissions you hold yourself. Greyed-out items are ones you don't have.
              </Typography>
              {Object.entries(groups).map(([group, perms]) => (
                <Box key={group} sx={{ mb: 1 }}>
                  <Typography variant="subtitle2">{group}</Typography>
                  <FormGroup>
                    {perms.map((perm) => {
                      const allowed = callerPermissions.includes(perm.key);
                      return (
                        <FormControlLabel
                          key={perm.key}
                          label={perm.label}
                          disabled={!allowed}
                          control={
                            <Checkbox
                              size="small"
                              checked={selected.has(perm.key)}
                              onChange={() => toggle(perm.key)}
                            />
                          }
                        />
                      );
                    })}
                  </FormGroup>
                </Box>
              ))}
            </FormControl>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={submitting || (!editing && !name.trim())}>
            {submitting ? 'Saving…' : 'Save role'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

export function AdminUsersPage() {
  const { email: currentEmail } = useAuth();
  const { settings, refresh: refreshSettings } = useSettings();
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [callerPermissions, setCallerPermissions] = useState([]);
  const [creating, setCreating] = useState(false);
  const [editingRole, setEditingRole] = useState(null); // null, 'new', or a role object
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteRoleTarget, setDeleteRoleTarget] = useState(null);
  const [error, setError] = useState('');

  const roleOptions = roles.map((r) => ({ value: r.name, label: r.name, help: r.description }));

  async function refresh() {
    const [{ data: userList }, { data: roleData }] = await Promise.all([
      api.get('/api/admin/users'),
      api.get('/api/admin/roles'),
    ]);
    setUsers(userList);
    setRoles(roleData.roles);
    setCatalog(roleData.permissions);
    setCallerPermissions(roleData.callerPermissions);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleDeleteRole() {
    setError('');
    try {
      await api.delete(`/api/admin/roles/${encodeURIComponent(deleteRoleTarget.name)}`);
      setDeleteRoleTarget(null);
      refresh();
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not delete the role.');
      setDeleteRoleTarget(null);
    }
  }

  async function handleChangeRole(user, role) {
    setError('');
    try {
      await api.patch(`/api/admin/users/${user.id}`, { role });
      refresh();
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not change the role.');
    }
  }

  async function handleResetMfa(user) {
    await api.patch(`/api/admin/users/${user.id}`, { resetMfa: true });
    refresh();
  }

  async function handleDelete() {
    setError('');
    try {
      await api.delete(`/api/admin/users/${deleteTarget.id}`);
      setDeleteTarget(null);
      refresh();
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not delete the user.');
      setDeleteTarget(null);
    }
  }

  async function handleToggleMfaRequired(e) {
    await api.put('/api/admin/settings', { mfaRequired: e.target.checked });
    refreshSettings();
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5" fontWeight={600}>
          Users
        </Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreating(true)}>
          Add user
        </Button>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <FormControlLabel
          control={<Switch checked={Boolean(settings.mfaRequired)} onChange={handleToggleMfaRequired} />}
          label="Require two-factor authentication for all users"
        />
      </Paper>

      <Paper variant="outlined">
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Email</TableCell>
              <TableCell>Role</TableCell>
              <TableCell>Sign-in method</TableCell>
              <TableCell>Two-factor</TableCell>
              <TableCell>Created</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id} hover>
                <TableCell>{user.email}</TableCell>
                <TableCell>
                  <TextField
                    select
                    size="small"
                    variant="standard"
                    value={user.role}
                    disabled={user.email === currentEmail}
                    onChange={(e) => handleChangeRole(user, e.target.value)}
                    slotProps={{ htmlInput: { 'aria-label': `Role for ${user.email}` } }}
                  >
                    {/* Keep an unknown role name (e.g. a deleted custom role) visible so it can be fixed. */}
                    {!roleOptions.some((o) => o.value === user.role) && (
                      <MenuItem value={user.role}>{user.role}</MenuItem>
                    )}
                    {roleOptions.map((option) => (
                      <MenuItem key={option.value} value={option.value}>
                        {option.label}
                      </MenuItem>
                    ))}
                  </TextField>
                </TableCell>
                <TableCell>{user.hasPassword ? 'Password' : 'SSO only'}</TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    label={user.mfaEnabled ? 'Enabled' : 'Not set up'}
                    color={user.mfaEnabled ? 'success' : 'default'}
                  />
                </TableCell>
                <TableCell>{new Date(user.createdAt).toLocaleDateString()}</TableCell>
                <TableCell align="right">
                  {user.mfaEnabled && (
                    <Tooltip title="Reset two-factor authentication">
                      <IconButton size="small" onClick={() => handleResetMfa(user)} aria-label="Reset MFA">
                        <LockResetIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                  <IconButton
                    size="small"
                    color="error"
                    disabled={user.email === currentEmail}
                    onClick={() => setDeleteTarget(user)}
                    aria-label="Delete"
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      <Paper variant="outlined" sx={{ mt: 3 }}>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', p: 2 }}>
          <Box>
            <Typography variant="subtitle1" fontWeight={600}>
              Roles
            </Typography>
            <Typography variant="body2" color="text.secondary">
              A role is a named set of permissions, such as Electrician or Read-only.
            </Typography>
          </Box>
          <Button variant="outlined" startIcon={<AddIcon />} onClick={() => setEditingRole('new')}>
            Create role
          </Button>
        </Stack>
        <Divider />
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Role</TableCell>
              <TableCell>Permissions</TableCell>
              <TableCell>Users</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {roles.map((role) => {
              const canEdit = role.builtIn === false && role.permissions.every((p) => callerPermissions.includes(p));
              return (
                <TableRow key={role.name} hover>
                  <TableCell>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <span>{role.name}</span>
                      {role.builtIn && <Chip size="small" label="Built in" variant="outlined" />}
                    </Stack>
                    {role.description && (
                      <Typography variant="caption" color="text.secondary">
                        {role.description}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    {role.permissions.length === catalog.length
                      ? 'All permissions'
                      : `${role.permissions.length} of ${catalog.length}`}
                  </TableCell>
                  <TableCell>{role.userCount}</TableCell>
                  <TableCell align="right">
                    {!role.builtIn && (
                      <>
                        <Tooltip title={canEdit ? 'Edit role' : "You can't edit a role with permissions you don't have"}>
                          <span>
                            <IconButton size="small" disabled={!canEdit} onClick={() => setEditingRole(role)} aria-label={`Edit ${role.name}`}>
                              <EditIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                        <Tooltip title={canEdit ? 'Delete role' : "You can't delete a role with permissions you don't have"}>
                          <span>
                            <IconButton size="small" color="error" disabled={!canEdit} onClick={() => setDeleteRoleTarget(role)} aria-label={`Delete ${role.name}`}>
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Paper>

      {editingRole && (
        <RoleDialog
          role={editingRole === 'new' ? null : editingRole}
          catalog={catalog}
          callerPermissions={callerPermissions}
          onClose={() => setEditingRole(null)}
          onSaved={() => {
            setEditingRole(null);
            refresh();
          }}
        />
      )}

      <Dialog open={Boolean(deleteRoleTarget)} onClose={() => setDeleteRoleTarget(null)}>
        <DialogTitle>Delete role?</DialogTitle>
        <DialogContent>
          <Typography>
            “{deleteRoleTarget?.name}” will be removed. Roles that still have users can't be deleted; move those users first.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteRoleTarget(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleDeleteRole}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      {creating && (
        <CreateUserDialog
          roleOptions={roleOptions}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            refresh();
          }}
        />
      )}

      <Dialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)}>
        <DialogTitle>Delete user?</DialogTitle>
        <DialogContent>
          <Typography>“{deleteTarget?.email}” will lose access immediately. This can't be undone.</Typography>
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
