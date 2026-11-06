import { siteConfig } from './runtimeConfig.js';
import { deliverEmail, emailProblem } from './channels/email.js';
import { deliverSms, smsProblem } from './channels/sms.js';
import { looksLikeEmail, normalizePhone } from './contact.js';

// Whether this site can send text messages.
export function smsAvailable() {
  return smsProblem(siteConfig().sms) === null;
}

// The mobile number a driver chose for text messages, checked. Returns { smsNumber }
// (null when they did not choose it) or { error }.
export function smsChoice(input) {
  if (input === undefined || input === null || String(input).trim() === '') return { smsNumber: null };
  if (!smsAvailable()) {
    return { error: "Text messages aren't set up for this charger. Leave the text message box unticked." };
  }
  const smsNumber = normalizePhone(String(input));
  if (!smsNumber) return { error: 'Enter a mobile number with its country code, for example +1 555 123 4567.' };
  return { smsNumber };
}

// Checks the contact a driver typed. Without text messages, the contact must be an
// e-mail address, because a phone number would never receive anything. Returns an
// error message, or null when the contact is fine.
export function contactProblem(contact) {
  const text = typeof contact === 'string' ? contact.trim() : '';
  if (looksLikeEmail(text)) return null;
  if (!smsAvailable()) return 'Enter an email address. Text messages aren\'t set up for this charger.';
  if (normalizePhone(text)) return null;
  return 'Enter an email address, or a mobile number with its country code, for example +1 555 123 4567.';
}

// Sends one message on one channel. A channel that isn't connected writes the message
// to the server log instead, so nothing is lost while a site is being set up. A failed
// send is logged and does not stop the caller.
async function sendOn(channel, to, problem, logText, deliver) {
  if (problem) {
    console.log(`[notify -> ${to}] (${channel} not sent: ${problem}) ${logText}`);
    return;
  }
  try {
    await deliver();
  } catch (err) {
    console.error(`[notify -> ${to}] ${channel} not sent: ${err.message}`);
  }
}

// Sends a message to a driver on every channel they chose. E-mail goes to the contact
// when it is an address. Text messages go to the mobile number they elected, or to the
// contact when the contact is a phone number. `message` is { subject, body, sms }.
export async function notifyDriver({ contact, smsNumber }, message) {
  const cfg = siteConfig();
  const emailTo = looksLikeEmail(contact) ? contact.trim() : null;
  const smsTo = normalizePhone(smsNumber) ?? (emailTo ? null : normalizePhone(contact));

  if (emailTo) {
    await sendOn(
      'e-mail',
      emailTo,
      emailProblem(cfg.email),
      `${message.subject}: ${message.body}`,
      () => deliverEmail(cfg.email, { to: emailTo, subject: message.subject, text: message.body }),
    );
  }
  if (smsTo) {
    await sendOn(
      'text message',
      smsTo,
      smsProblem(cfg.sms),
      message.sms,
      () => deliverSms(cfg.sms, { to: smsTo, body: message.sms }),
    );
  }
}
