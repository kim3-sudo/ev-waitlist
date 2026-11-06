import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Chip,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

// Replaces each {name} with its example value, to show roughly what a driver will read.
function withExamples(text, variables) {
  const examples = Object.fromEntries(variables.map((v) => [v.name, v.example]));
  return text.replace(/\{([A-Za-z]+)\}/g, (_, name) => examples[name] ?? '');
}

function TemplateEditor({ template, canManage, onClose, onSaved }) {
  const [subject, setSubject] = useState(template.subject);
  const [body, setBody] = useState(template.body);
  const [sms, setSms] = useState(template.sms);
  // The field a placeholder chip adds to: the one the admin clicked last.
  const [target, setTarget] = useState('body');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Adds a placeholder at the end of the chosen message text.
  function insert(name) {
    if (target === 'sms') setSms((text) => `${text}{${name}}`);
    else setBody((text) => `${text}{${name}}`);
  }

  async function save() {
    setError('');
    setBusy(true);
    try {
      const { data } = await api.put(`/api/admin/templates/${template.key}`, { subject, body, sms });
      onSaved(data);
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not save this message.');
    } finally {
      setBusy(false);
    }
  }

  async function resetToDefault() {
    setError('');
    setBusy(true);
    try {
      const { data } = await api.delete(`/api/admin/templates/${template.key}`);
      onSaved(data);
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not reset this message.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="template-title">
      <DialogTitle id="template-title">{template.title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <Typography variant="body2" color="text.secondary">{template.description}</Typography>

          <TextField
            label="Subject"
            helperText="A short title, shown by channels that have one, such as e-mail."
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            disabled={!canManage}
            fullWidth
          />
          <TextField
            label="Message"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onFocus={() => setTarget('body')}
            multiline
            minRows={3}
            disabled={!canManage}
            fullWidth
          />
          <TextField
            label="Text message"
            helperText={`Sent to drivers who choose text messages. Up to 480 characters. ${sms.length}/480`}
            value={sms}
            onChange={(e) => setSms(e.target.value)}
            onFocus={() => setTarget('sms')}
            multiline
            minRows={2}
            disabled={!canManage}
            fullWidth
          />

          <Stack spacing={1}>
            <Typography variant="caption" color="text.secondary">
              Click a placeholder to add it to the message or text message you clicked last.
            </Typography>
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
              {template.variables.map((v) => (
                <Chip
                  key={v.name}
                  size="small"
                  variant="outlined"
                  label={`{${v.name}}`}
                  title={v.label}
                  onClick={canManage ? () => insert(v.name) : undefined}
                  disabled={!canManage}
                />
              ))}
            </Stack>
          </Stack>

          <Paper variant="outlined" sx={{ p: 2, bgcolor: 'action.hover' }}>
            <Typography variant="caption" color="text.secondary">Preview with example values</Typography>
            <Typography fontWeight={600}>{withExamples(subject, template.variables)}</Typography>
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
              {withExamples(body, template.variables)}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
              Text message preview
            </Typography>
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
              {withExamples(sms, template.variables)}
            </Typography>
          </Paper>

          {template.customized && (
            <Typography variant="caption" color="text.secondary">
              This message uses your own wording. Reset it to bring back the built-in text.
            </Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, justifyContent: 'space-between' }}>
        <Button color="inherit" onClick={resetToDefault} disabled={busy || !canManage || !template.customized}>
          Reset to built-in text
        </Button>
        <Stack direction="row" spacing={1}>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="contained" onClick={save} disabled={busy || !canManage}>
            {busy ? 'Saving…' : 'Save message'}
          </Button>
        </Stack>
      </DialogActions>
    </Dialog>
  );
}

// The messages the app sends to drivers, and their wording for this site.
export function AdminTemplatesPage() {
  const { can } = useAuth();
  const canManage = can('branding.manage');
  const [templates, setTemplates] = useState([]);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function load() {
    try {
      const { data } = await api.get('/api/admin/templates');
      setTemplates(data);
    } catch {
      setError('Could not load the messages.');
    }
  }

  useEffect(() => {
    load();
  }, []);

  function handleSaved(updated) {
    setTemplates((list) => list.map((t) => (t.key === updated.key ? updated : t)));
    setNotice(`"${updated.title}" saved.`);
    setEditing(null);
  }

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Typography variant="h5" fontWeight={600} gutterBottom>
        Message templates
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        The messages drivers receive, such as an e-mail or text when their charger is ready. Change the wording here.
        Placeholders such as {'{station}'} are filled in when the message is sent. Each message stays in the built-in
        wording until you change it.
      </Typography>
      <Alert severity="info" sx={{ mb: 2 }}>
        Messages are written to the server log until an e-mail or text message provider is connected.
      </Alert>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {notice && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice('')}>
          {notice}
        </Alert>
      )}

      <Stack spacing={2}>
        {templates.map((t) => (
          <Paper key={t.key} variant="outlined" sx={{ p: 2 }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
              <Stack sx={{ flexGrow: 1, minWidth: 0 }}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Typography fontWeight={600}>{t.title}</Typography>
                  {t.customized && <Chip size="small" color="primary" variant="outlined" label="Your wording" />}
                </Stack>
                <Typography variant="body2" color="text.secondary">{t.description}</Typography>
                <Typography variant="body2" sx={{ mt: 1, whiteSpace: 'pre-wrap' }} noWrap>
                  {t.body}
                </Typography>
              </Stack>
              <Button variant="outlined" onClick={() => setEditing(t)}>
                {canManage ? 'Edit' : 'View'}
              </Button>
            </Stack>
          </Paper>
        ))}
      </Stack>

      {editing && (
        <TemplateEditor
          key={editing.key}
          template={editing}
          canManage={canManage}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}
    </Container>
  );
}
