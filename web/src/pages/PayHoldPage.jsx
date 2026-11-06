import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Alert, Button, Container, Paper, Stack, Typography, CircularProgress } from '@mui/material';
import dropin from 'braintree-web-drop-in';
import { api } from '../api/client.js';

// Public page where a waitlisted driver places a card hold before they plug in.
// The hold reserves the amount on the card. Only the actual cost of the session
// is taken, and the rest is released. Card details never reach this server:
// Stripe takes the card on its hosted page, and Braintree's Drop-in sends it straight to Braintree.

function money(cents, currency) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

export function PayHoldPage() {
  const { token } = useParams();
  const [params] = useSearchParams();
  const [hold, setHold] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const dropinContainer = useRef(null);
  const dropinInstance = useRef(null);

  async function load() {
    try {
      const { data } = await api.get(`/api/pay/hold/${token}`);
      setHold(data);
      return data;
    } catch (err) {
      if (err.response?.status === 404) setNotFound(true);
      else setError('Could not load this page. Try again in a moment.');
      return null;
    }
  }

  useEffect(() => {
    load().then(async (latest) => {
      // Back from Stripe Checkout: confirm the hold is in place.
      if (latest && latest.status === 'AWAITING' && params.get('held') === '1') {
        try {
          await api.post(`/api/pay/hold/${token}/stripe/confirm`);
          await load();
        } catch {
          setError('We could not confirm the hold yet. Refresh this page in a moment.');
        }
      }
    });
  }, [token]);

  // Braintree: mount the Drop-in card form once we have a client token.
  useEffect(() => {
    if (!hold?.braintreeClientToken || hold.status !== 'AWAITING' || !dropinContainer.current) return undefined;
    let cancelled = false;
    dropin
      .create({ authorization: hold.braintreeClientToken, container: dropinContainer.current, card: {} })
      .then((instance) => {
        if (cancelled) return instance.teardown();
        dropinInstance.current = instance;
      })
      .catch(() => setError('The card form could not load. Try again later.'));
    return () => {
      cancelled = true;
      dropinInstance.current?.teardown?.();
      dropinInstance.current = null;
    };
  }, [hold?.braintreeClientToken, hold?.status]);

  async function placeWithStripe() {
    setError('');
    setBusy(true);
    try {
      const { data } = await api.post(`/api/pay/hold/${token}/stripe`);
      window.location.assign(data.url);
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not start the card hold.');
      setBusy(false);
    }
  }

  async function placeWithBraintree() {
    setError('');
    setBusy(true);
    try {
      const { nonce } = await dropinInstance.current.requestPaymentMethod();
      await api.post(`/api/pay/hold/${token}/braintree`, { nonce });
      await load();
    } catch (err) {
      setError(err.response?.data?.error ?? err.message ?? 'The card hold did not go through.');
    } finally {
      setBusy(false);
    }
  }

  if (notFound) {
    return (
      <Container maxWidth="sm" sx={{ py: 6 }}>
        <Alert severity="error">This link doesn't exist or has expired.</Alert>
      </Container>
    );
  }
  if (!hold) {
    return (
      <Container maxWidth="sm" sx={{ py: 6, textAlign: 'center' }}>
        {error ? <Alert severity="error">{error}</Alert> : <CircularProgress />}
      </Container>
    );
  }

  const amount = money(hold.amountCents, hold.currency);

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Typography variant="h5" fontWeight={600} gutterBottom>
          Card hold for your charging session
        </Typography>
        <Typography variant="h4" fontWeight={600} sx={{ my: 2 }}>
          {amount}
        </Typography>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {hold.status === 'HELD' && (
          <Alert severity="success">
            Your card hold is in place. You can plug in now. You're charged only for what the session costs, and any
            unused part of the hold is released.
          </Alert>
        )}
        {hold.status === 'AWAITING' && (
          <Stack spacing={2}>
            <Typography>
              Place a hold of {amount} on your card before you plug in. The hold is not a charge. You pay only the
              actual cost of your session, and the rest of the hold is released.
            </Typography>
            {hold.provider === 'STRIPE' && (
              <Button variant="contained" size="large" fullWidth onClick={placeWithStripe} disabled={busy}>
                {busy ? 'Opening checkout…' : 'Place card hold'}
              </Button>
            )}
            {hold.provider === 'BRAINTREE' && (
              <>
                <div ref={dropinContainer} />
                <Button
                  variant="contained"
                  size="large"
                  fullWidth
                  onClick={placeWithBraintree}
                  disabled={busy || !dropinInstance.current}
                >
                  {busy ? 'Placing hold…' : 'Place card hold'}
                </Button>
              </>
            )}
          </Stack>
        )}
        {hold.status === 'RELEASED' && <Alert severity="info">This hold is no longer needed.</Alert>}
        {hold.status === 'FAILED' && (
          <Alert severity="warning">The card hold could not be placed. Please ask the operator how to pay.</Alert>
        )}
        {hold.status === 'IN_USE' || hold.status === 'CAPTURED' ? (
          <Alert severity="info">Your session has started. You'll get a payment link if anything is owed.</Alert>
        ) : null}
      </Paper>
    </Container>
  );
}
