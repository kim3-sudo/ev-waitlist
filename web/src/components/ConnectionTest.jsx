import { useState } from 'react';
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, CircularProgress, Stack, Typography } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import RemoveIcon from '@mui/icons-material/Remove';
import { api } from '../api/client.js';

// The checks, in the order they run. The server runs each one when the page asks for it,
// so every result shows as soon as it arrives. `details` explains what each check does,
// and is shown when a step is expanded.
const STEPS = [
  {
    id: 'connected',
    label: 'Connected to the app',
    details: 'Checks that the charge point has opened a connection to this server.',
  },
  {
    id: 'configuration',
    label: 'Answers a request',
    details: 'Asks the charge point for its settings. An answer shows that requests reach it and it replies.',
  },
  {
    id: 'deactivate',
    label: 'Taken out of service (sent by the app)',
    details: 'Tells the charge point to become unavailable. If a charging session is in progress, this check fails and the charge point is not changed.',
  },
  {
    id: 'deactivated',
    label: 'Reports it is unavailable',
    details: 'Waits for the charge point to report that it is unavailable after the previous step.',
  },
  {
    id: 'activate',
    label: 'Returned to service (sent by the app)',
    details: 'Tells the charge point to return to service. It still runs when a later check fails, so the charge point is not left out of service.',
  },
  {
    id: 'activated',
    label: 'Reports it is back in service',
    details: 'Waits for the charge point to report a status other than unavailable or faulted.',
  },
];

// Steps that must pass before the charge point is changed at all.
const BEFORE_CHANGE = ['connected', 'configuration'];

function StepIcon({ state }) {
  if (state === 'running') return <CircularProgress size={20} aria-label="Running" />;
  if (state === 'ok') return <CheckCircleIcon color="success" aria-label="Passed" />;
  if (state === 'fail') return <CancelIcon color="error" aria-label="Failed" />;
  if (state === 'skipped') return <RemoveIcon color="disabled" aria-label="Skipped" />;
  return <RadioButtonUncheckedIcon color="disabled" aria-label="Not run yet" />;
}

// Tests a saved charge point, one step at a time, and shows each step as it runs.
// It takes the charge point out of service and back, so the admin is told that first.
// `identity` is the charge point's OCPP identity. Disabled until there is one.
export function ConnectionTest({ identity, disabled = false, disabledReason }) {
  const initial = () => Object.fromEntries(STEPS.map((s) => [s.id, { state: 'pending', message: '', details: [] }]));
  const [results, setResults] = useState(initial);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);

  function setStep(id, patch) {
    setResults((r) => ({ ...r, [id]: { ...r[id], ...patch } }));
  }

  async function run() {
    setRunning(true);
    setFinished(false);
    setResults(initial());
    // Status reports must come after this moment to count for the test.
    const since = new Date().toISOString();
    let stopped = false;
    try {
      for (const step of STEPS) {
        if (stopped) {
          setStep(step.id, { state: 'skipped', message: 'Not run, because an earlier check failed.' });
          continue;
        }
        setStep(step.id, { state: 'running' });
        let ok;
        let message;
        let details = [];
        try {
          const { data } = await api.post(`/api/admin/stations/test-connection/${step.id}`, { identity, since });
          ok = data.ok;
          message = data.message;
          details = Array.isArray(data.details) ? data.details : [];
        } catch (err) {
          ok = false;
          message = err.response?.data?.error ?? 'Could not run this check.';
        }
        setStep(step.id, { state: ok ? 'ok' : 'fail', message, details });
        // Before the charge point is changed, any failure stops the test. After that, the test
        // still tries to bring the charge point back into service, even if a check failed.
        if (!ok && BEFORE_CHANGE.includes(step.id)) stopped = true;
      }
    } finally {
      setRunning(false);
      setFinished(true);
    }
  }

  const values = Object.values(results);
  const allPassed = finished && values.every((r) => r.state === 'ok');
  const anyFailed = values.some((r) => r.state === 'fail');
  const activationFailed = results.activate.state === 'fail' || results.activated.state === 'fail';

  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        This test takes the charge point out of service for a moment, then returns it to service. It doesn't start a
        charging session. Run it when nobody is charging on this charge point.
      </Typography>

      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Button variant="outlined" onClick={run} disabled={running || disabled || !identity}>
          {running ? 'Testing…' : finished ? 'Run the test again' : 'Test connection'}
        </Button>
        {disabled && disabledReason && (
          <Typography variant="caption" color="text.secondary">
            {disabledReason}
          </Typography>
        )}
      </Stack>

      {(running || finished) && (
        <Stack component="ol" spacing={1} sx={{ listStyle: 'none', p: 0, m: 0 }} aria-label="Test steps">
          {STEPS.map((step) => {
            const r = results[step.id];
            return (
              <Stack key={step.id} component="li">
                <Accordion disableGutters variant="outlined" sx={{ '&::before': { display: 'none' } }}>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />} aria-controls={`${step.id}-details`}>
                    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
                      <span style={{ display: 'inline-flex', width: 24, justifyContent: 'center', paddingTop: 2 }}>
                        <StepIcon state={r.state} />
                      </span>
                      <Stack>
                        <Typography variant="body2" fontWeight={r.state === 'running' ? 600 : 400}>
                          {step.label}
                        </Typography>
                        {r.message && (
                          <Typography variant="caption" color={r.state === 'fail' ? 'error' : 'text.secondary'}>
                            {r.message}
                          </Typography>
                        )}
                      </Stack>
                    </Stack>
                  </AccordionSummary>
                  <AccordionDetails id={`${step.id}-details`} sx={{ pl: 6 }}>
                    <Stack spacing={1.5}>
                      <Typography variant="body2" color="text.secondary">
                        {step.details}
                      </Typography>
                      {r.details.length > 0 && (
                        <Box
                          component="pre"
                          aria-label={`${step.label} results`}
                          sx={{
                            m: 0,
                            p: 1.5,
                            maxHeight: 240,
                            overflow: 'auto',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                            fontFamily: 'monospace',
                            fontSize: '0.8125rem',
                            bgcolor: 'action.hover',
                            borderRadius: 1,
                          }}
                        >
                          {r.details.join('\n')}
                        </Box>
                      )}
                    </Stack>
                  </AccordionDetails>
                </Accordion>
              </Stack>
            );
          })}
        </Stack>
      )}

      {finished && allPassed && (
        <Alert severity="success">
          All checks passed. The software can take this charge point out of service and bring it back.
        </Alert>
      )}
      {finished && anyFailed && (
        <Alert severity="error">
          {activationFailed
            ? 'A check failed, and the charge point may not be back in service. Check it on site, then run the test again.'
            : 'A check failed. Read the step that failed, fix it, then run the test again.'}
        </Alert>
      )}
    </Stack>
  );
}
