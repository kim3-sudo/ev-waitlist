// The help details a driver sees in the waitlist's Help tab, set by an admin on the
// About page: e-mail addresses, phone numbers and a contact form link. Stored as JSON
// on the site's settings row. Pure functions, so they can be tested directly.

export const HELP_LIMITS = { emails: 10, phones: 10, itemMax: 200, urlMax: 500 };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_CHARS = /^\+?[0-9 ()\-.]+$/;

export function emptyHelpContacts() {
  return { emails: [], phones: [], contactFormUrl: '' };
}

// The stored JSON as an object, with safe defaults for anything missing or malformed.
export function parseHelpContacts(text) {
  if (!text) return emptyHelpContacts();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return emptyHelpContacts();
  }
  return {
    emails: Array.isArray(parsed?.emails) ? parsed.emails.filter((e) => typeof e === 'string') : [],
    phones: Array.isArray(parsed?.phones) ? parsed.phones.filter((p) => typeof p === 'string') : [],
    contactFormUrl: typeof parsed?.contactFormUrl === 'string' ? parsed.contactFormUrl : '',
  };
}

function cleanList(list, label, check, max) {
  if (!Array.isArray(list)) return { error: `${label} must be a list` };
  if (list.length > max) return { error: `${label}: at most ${max} entries` };
  const out = [];
  for (const raw of list) {
    if (typeof raw !== 'string') return { error: `${label} must be text` };
    const value = raw.trim();
    if (!value) continue;
    if (value.length > HELP_LIMITS.itemMax) return { error: `${label}: each entry is at most ${HELP_LIMITS.itemMax} characters` };
    const problem = check(value);
    if (problem) return { error: `${label}: ${problem}` };
    if (!out.includes(value)) out.push(value);
  }
  return { value: out };
}

function emailProblem(value) {
  return EMAIL_PATTERN.test(value) ? null : `"${value}" is not an e-mail address`;
}

function phoneProblem(value) {
  if (!PHONE_CHARS.test(value)) return `"${value}" should contain only digits, spaces, + ( ) - or .`;
  const digits = value.replace(/\D/g, '');
  if (digits.length < 5 || digits.length > 15) return `"${value}" should have between 5 and 15 digits`;
  return null;
}

function contactFormProblem(value) {
  if (!value) return null;
  if (value.length > HELP_LIMITS.urlMax) return `The contact form link is at most ${HELP_LIMITS.urlMax} characters`;
  let url;
  try {
    url = new URL(value);
  } catch {
    return 'The contact form link must be a full web address, starting with https://';
  }
  return url.protocol === 'https:' || url.protocol === 'http:' ? null : 'The contact form link must start with https://';
}

// Checks what the About page sent. Blank entries are dropped. Returns { value } ready to
// store, or { error }. Undefined fields are not valid input here: the caller omits the key.
export function normalizeHelpContacts(input) {
  if (input == null || typeof input !== 'object') return { error: 'helpContacts must be an object' };

  const emails = cleanList(input.emails ?? [], 'E-mail addresses', emailProblem, HELP_LIMITS.emails);
  if (emails.error) return { error: emails.error };
  const phones = cleanList(input.phones ?? [], 'Phone numbers', phoneProblem, HELP_LIMITS.phones);
  if (phones.error) return { error: phones.error };

  let contactFormUrl = '';
  if (input.contactFormUrl != null && input.contactFormUrl !== '') {
    if (typeof input.contactFormUrl !== 'string') return { error: 'The contact form link must be text' };
    contactFormUrl = input.contactFormUrl.trim();
    const problem = contactFormProblem(contactFormUrl);
    if (problem) return { error: problem };
  }

  return { value: { emails: emails.value, phones: phones.value, contactFormUrl } };
}
