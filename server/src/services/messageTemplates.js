import { prisma } from '../db.js';

// The messages the app sends to drivers. Each site can change the wording of any of
// them. A placeholder such as {station} is filled in when the message is sent. A
// placeholder that a message does not list is refused when the wording is saved.
export const TEMPLATE_DEFS = {
  READY_TO_CHARGE: {
    title: 'Ready to charge',
    description: 'Sent when a charge point is free for the next driver in line.',
    variables: [
      { name: 'station', label: 'Charge point', example: 'Garage P1, Bay 3' },
      { name: 'deadline', label: 'Plug-in deadline', example: '10:15 AM' },
      { name: 'hold', label: 'Card hold sentence', example: ' Before you plug in, place a hold of $20.00 on your card.' },
    ],
    subject: 'Your charger is ready',
    body: '{station} is ready for you. Plug in by {deadline} or your spot will be released.{hold}',
    sms: '{station} is ready. Plug in by {deadline} or your spot will be released.{hold}',
  },
  MOVE_VEHICLE: {
    title: 'Please move your vehicle',
    description: 'Sent to the driver whose charging has finished, so the next driver can use the charge point.',
    variables: [{ name: 'station', label: 'Charge point', example: 'Garage P1, Bay 3' }],
    subject: 'Please move your vehicle',
    body: 'Your charging session at {station} is complete. Please unplug and move your vehicle for the next person.',
    sms: 'Your charge at {station} is complete. Please move your vehicle so the next driver can charge.',
  },
  NEXT_IN_LINE: {
    title: 'You are next in line',
    description: 'Sent to the next driver in line while the current vehicle finishes charging.',
    variables: [{ name: 'station', label: 'Charge point', example: 'Garage P1, Bay 3' }],
    subject: "You're next in line",
    body: "You're next in line for {station}. The current vehicle is finishing up. Get ready, and we'll notify you the moment it's free.",
    sms: "You're next in line for {station}. We'll text you the moment it's free.",
  },
  PAYMENT_DUE: {
    title: 'Payment for a session',
    description: 'Sent with the payment link when a session ends and the driver has to pay.',
    variables: [
      { name: 'station', label: 'Charge point', example: 'Garage P1, Bay 3' },
      { name: 'amount', label: 'Amount', example: '$4.50' },
      { name: 'paymentLink', label: 'Payment link', example: 'https://ev.example.com/pay/abc' },
    ],
    subject: 'Payment for your charging session',
    body: 'Your charging session at {station} cost {amount}. Pay here: {paymentLink}',
    sms: 'Your charge at {station} cost {amount}. Pay here: {paymentLink}',
  },
  PAYMENT_DUE_AFTER_HOLD: {
    title: 'Balance after a card hold',
    description: 'Sent when the card hold covered part of the session cost, and the driver owes the rest.',
    variables: [
      { name: 'station', label: 'Charge point', example: 'Garage P1, Bay 3' },
      { name: 'amount', label: 'Session cost', example: '$4.50' },
      { name: 'held', label: 'Amount covered by the hold', example: '$4.50' },
      { name: 'balance', label: 'Amount still owed', example: '$0.00' },
      { name: 'paymentLink', label: 'Payment link', example: 'https://ev.example.com/pay/abc' },
    ],
    subject: 'Payment for your charging session',
    body: 'Your charging session at {station} cost {amount}. Your card hold covered {held}. Pay the remaining {balance} here: {paymentLink}',
    sms: 'Your charge at {station} cost {amount}. Your card hold covered {held}. Pay the remaining {balance}: {paymentLink}',
  },
};

export const TEMPLATE_KEYS = Object.keys(TEMPLATE_DEFS);

const PLACEHOLDER = /\{([A-Za-z]+)\}/g;
const MAX_SUBJECT = 200;
const MAX_BODY = 2000;
// Three standard text messages, so a longer wording is refused.
const MAX_SMS = 480;

// Fills in the placeholders of one piece of text. A missing value becomes empty text.
export function fill(text, values) {
  return text.replace(PLACEHOLDER, (_, name) => values[name] ?? '');
}

// Checks wording for a message. Returns null when it is fine, or the reason it is not.
export function templateProblem(key, { subject, body, sms }) {
  const def = TEMPLATE_DEFS[key];
  if (!def) return 'Unknown message';
  if (typeof subject !== 'string' || !subject.trim()) return 'The subject is required';
  if (typeof body !== 'string' || !body.trim()) return 'The e-mail text is required';
  if (typeof sms !== 'string' || !sms.trim()) return 'The text message is required';
  if (subject.length > MAX_SUBJECT) return `The subject can be at most ${MAX_SUBJECT} characters`;
  if (body.length > MAX_BODY) return `The e-mail text can be at most ${MAX_BODY} characters`;
  if (sms.length > MAX_SMS) return `The text message can be at most ${MAX_SMS} characters`;
  const allowed = new Set(def.variables.map((v) => v.name));
  for (const text of [subject, body, sms]) {
    for (const [, name] of text.matchAll(PLACEHOLDER)) {
      if (!allowed.has(name)) {
        return `{${name}} isn't available in this message. Use only: ${[...allowed].map((n) => `{${n}}`).join(', ')}`;
      }
    }
  }
  return null;
}

// The stored wording for this site, by key.
async function storedWording() {
  const rows = await prisma.messageTemplate.findMany({ select: { key: true, subject: true, body: true, smsBody: true } });
  return new Map(rows.map((row) => [row.key, row]));
}

// Every message with the wording in use: the site's own, or the built-in default.
export async function listTemplates() {
  const stored = await storedWording();
  return TEMPLATE_KEYS.map((key) => {
    const def = TEMPLATE_DEFS[key];
    const own = stored.get(key);
    return {
      key,
      title: def.title,
      description: def.description,
      variables: def.variables,
      subject: own?.subject ?? def.subject,
      body: own?.body ?? def.body,
      sms: own?.smsBody ?? def.sms,
      customized: Boolean(own),
      defaultSubject: def.subject,
      defaultBody: def.body,
      defaultSms: def.sms,
    };
  });
}

// The e-mail subject, e-mail text and text message to send for one message, filled in
// with the given values.
export async function renderMessage(key, values = {}) {
  const def = TEMPLATE_DEFS[key];
  if (!def) throw new Error(`Unknown message ${key}`);
  const own = await prisma.messageTemplate.findFirst({ where: { key }, select: { subject: true, body: true, smsBody: true } });
  return {
    subject: fill(own?.subject ?? def.subject, values),
    body: fill(own?.body ?? def.body, values),
    sms: fill(own?.smsBody ?? def.sms, values),
  };
}

// Sets the site's wording for a message, after checking it.
export async function saveTemplate(key, { subject, body, sms }) {
  const problem = templateProblem(key, { subject, body, sms });
  if (problem) return { error: problem };
  const existing = await prisma.messageTemplate.findFirst({ where: { key } });
  if (existing) {
    await prisma.messageTemplate.update({ where: { id: existing.id }, data: { subject, body, smsBody: sms } });
  } else {
    await prisma.messageTemplate.create({ data: { key, subject, body, smsBody: sms } });
  }
  return { ok: true };
}

// Drops the site's wording for a message, so the built-in text is used again.
export async function resetTemplate(key) {
  if (!TEMPLATE_DEFS[key]) return { error: 'Unknown message' };
  await prisma.messageTemplate.deleteMany({ where: { key } });
  return { ok: true };
}
