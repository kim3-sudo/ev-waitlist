// Sends text messages for one site. Twilio is the only provider for now; the site's
// settings are passed in (siteConfig().sms), so the provider is always the site's own.

const TIMEOUT_MS = 15000;

// Returns why text messages can't be sent with these settings, or null when they can.
export function smsProblem(cfg) {
  if (cfg.provider === 'NONE') return 'Text messages are not connected yet.';
  switch (cfg.provider) {
    case 'TWILIO':
      if (!cfg.twilio.accountSid || !cfg.twilio.authToken) return 'Enter the Twilio account SID and auth token.';
      if (!cfg.twilio.sender) return 'Enter the Twilio phone number or Messaging Service SID to send from.';
      return null;
    default:
      return `Unknown text message provider: ${cfg.provider}`;
  }
}

// Sends one text message. Throws with a readable reason on failure.
export async function deliverSms(cfg, { to, body }) {
  const problem = smsProblem(cfg);
  if (problem) throw new Error(problem);

  const { accountSid, authToken, sender } = cfg.twilio;
  const form = new URLSearchParams({ To: to, Body: body });
  // A Messaging Service SID starts with MG; anything else is a sender number.
  if (sender.startsWith('MG')) form.set('MessagingServiceSid', sender);
  else form.set('From', sender);

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(`Twilio refused the message${data.message ? `: ${data.message}` : ` (HTTP ${res.status})`}`);
  }
}
