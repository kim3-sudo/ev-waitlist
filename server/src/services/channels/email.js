import nodemailer from 'nodemailer';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

// Sends e-mail for one site. The site's settings are passed in (siteConfig().email),
// so the provider is always the site's own.

const TIMEOUT_MS = 15000;

// Returns why e-mail can't be sent with these settings, or null when it can.
export function emailProblem(cfg) {
  if (cfg.provider === 'NONE') return 'E-mail is not connected yet.';
  if (!cfg.fromAddress) return 'Enter the From address.';
  switch (cfg.provider) {
    case 'SMTP':
      if (!cfg.smtp.host) return 'Enter the SMTP server address.';
      return null;
    case 'SES':
      if (!cfg.ses.region || !cfg.ses.accessKeyId || !cfg.ses.secretAccessKey) {
        return 'Enter the Amazon SES region, access key ID and secret access key.';
      }
      return null;
    case 'POSTMARK':
      return cfg.postmark.serverToken ? null : 'Enter the Postmark server API token.';
    case 'SENDGRID':
      return cfg.sendgrid.apiKey ? null : 'Enter the SendGrid API key.';
    default:
      return `Unknown e-mail provider: ${cfg.provider}`;
  }
}

// "Name" <address> for headers that take one string.
function fromHeader(cfg) {
  if (!cfg.fromName) return cfg.fromAddress;
  return `"${cfg.fromName.replace(/["\\]/g, '')}" <${cfg.fromAddress}>`;
}

async function failureMessage(res, provider) {
  const data = await res.json().catch(() => ({}));
  const detail = data.Message ?? data.errors?.[0]?.message ?? data.message;
  return `${provider} refused the message${detail ? `: ${detail}` : ` (HTTP ${res.status})`}`;
}

async function sendSmtp(cfg, mail) {
  const transport = nodemailer.createTransport({
    host: cfg.smtp.host,
    port: Number(cfg.smtp.port),
    secure: cfg.smtp.secure === 'TLS',
    requireTLS: cfg.smtp.secure === 'STARTTLS',
    ignoreTLS: cfg.smtp.secure === 'NONE',
    auth: cfg.smtp.username ? { user: cfg.smtp.username, pass: cfg.smtp.password } : undefined,
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: 30000,
  });
  try {
    await transport.sendMail({ from: fromHeader(cfg), to: mail.to, subject: mail.subject, text: mail.text });
  } finally {
    transport.close();
  }
}

async function sendSes(cfg, mail) {
  const client = new SESv2Client({
    region: cfg.ses.region,
    credentials: { accessKeyId: cfg.ses.accessKeyId, secretAccessKey: cfg.ses.secretAccessKey },
  });
  await client.send(
    new SendEmailCommand({
      FromEmailAddress: fromHeader(cfg),
      Destination: { ToAddresses: [mail.to] },
      Content: {
        Simple: {
          Subject: { Data: mail.subject, Charset: 'UTF-8' },
          Body: { Text: { Data: mail.text, Charset: 'UTF-8' } },
        },
      },
    }),
  );
}

async function sendPostmark(cfg, mail) {
  const res = await fetch('https://api.postmarkapp.com/email', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Postmark-Server-Token': cfg.postmark.serverToken,
    },
    body: JSON.stringify({
      From: fromHeader(cfg),
      To: mail.to,
      Subject: mail.subject,
      TextBody: mail.text,
      MessageStream: 'outbound',
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Postmark'));
}

async function sendSendGrid(cfg, mail) {
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.sendgrid.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: mail.to }] }],
      from: cfg.fromName ? { email: cfg.fromAddress, name: cfg.fromName } : { email: cfg.fromAddress },
      subject: mail.subject,
      content: [{ type: 'text/plain', value: mail.text }],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'SendGrid'));
}

// Sends one e-mail with the site's provider. Throws with a readable reason on failure.
export async function deliverEmail(cfg, { to, subject, text }) {
  const problem = emailProblem(cfg);
  if (problem) throw new Error(problem);
  const mail = { to, subject, text };
  switch (cfg.provider) {
    case 'SMTP':
      return sendSmtp(cfg, mail);
    case 'SES':
      return sendSes(cfg, mail);
    case 'POSTMARK':
      return sendPostmark(cfg, mail);
    case 'SENDGRID':
      return sendSendGrid(cfg, mail);
    default:
      throw new Error(`Unknown e-mail provider: ${cfg.provider}`);
  }
}
