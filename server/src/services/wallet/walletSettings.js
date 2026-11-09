import crypto from 'node:crypto';
import { designCheck } from './design.js';

// Checks the wallet settings of a site. `apple` and `google` are the resolved values from
// siteConfig().wallet (secrets decrypted in memory only). Each check reports what is
// `missing` (needed before a pass can be issued) and what is `invalid` (a value that is
// wrong, which is refused when it is saved). A platform is `ready` when it has neither.

const APPLE_FIELDS = [
  ['passTypeIdentifier', 'Pass type identifier'],
  ['teamIdentifier', 'Team identifier'],
  ['organizationName', 'Organization name'],
  ['signingCertificate', 'Pass certificate'],
  ['signingKey', 'Pass certificate private key'],
  ['wwdrCertificate', 'Apple WWDR certificate'],
];

const GOOGLE_FIELDS = [
  ['issuerId', 'Issuer ID'],
  ['classId', 'Class ID'],
  ['serviceAccountKey', 'Service account key'],
];

function parseCertificate(pem) {
  try {
    return new crypto.X509Certificate(pem);
  } catch {
    return null;
  }
}

function parsePrivateKey(pem) {
  try {
    return crypto.createPrivateKey(pem);
  } catch {
    return null;
  }
}

// Turns the stored service account JSON into what a Google save link needs, or null when
// the JSON is not a service account key.
export function googleCredentials(google) {
  if (!google?.serviceAccountKey || !google.issuerId || !google.classId) return null;
  let parsed;
  try {
    parsed = JSON.parse(google.serviceAccountKey);
  } catch {
    return null;
  }
  if (!parsed?.client_email || !parsed?.private_key) return null;
  if (!parsePrivateKey(parsed.private_key)) return null;
  return {
    issuerId: google.issuerId,
    classId: google.classId,
    clientEmail: parsed.client_email,
    privateKey: parsed.private_key,
  };
}

export function appleCheck(apple = {}) {
  const configured = APPLE_FIELDS.some(([key]) => Boolean(apple[key]));
  const missing = APPLE_FIELDS.filter(([key]) => !apple[key]).map(([, label]) => label);
  const invalid = [];

  if (apple.passTypeIdentifier && !/^pass\.[A-Za-z0-9.-]+$/.test(apple.passTypeIdentifier)) {
    invalid.push('The pass type identifier must look like pass.com.example.charging.');
  }
  if (apple.teamIdentifier && !/^[A-Z0-9]{10}$/.test(apple.teamIdentifier)) {
    invalid.push('The team identifier is 10 capital letters or digits, from your Apple developer account.');
  }
  if (apple.organizationName && apple.organizationName.length > 60) {
    invalid.push('The organization name can be at most 60 characters.');
  }

  const certificate = apple.signingCertificate ? parseCertificate(apple.signingCertificate) : null;
  if (apple.signingCertificate && !certificate) {
    invalid.push('The pass certificate must be a PEM certificate, starting with BEGIN CERTIFICATE.');
  } else if (certificate && apple.passTypeIdentifier && !certificate.subject.includes(`Pass Type ID: ${apple.passTypeIdentifier}`)) {
    invalid.push('The pass certificate is for a different pass type identifier.');
  }

  const key = apple.signingKey ? parsePrivateKey(apple.signingKey) : null;
  if (apple.signingKey && !key) {
    invalid.push('The private key must be an unencrypted PEM key, starting with BEGIN PRIVATE KEY or BEGIN RSA PRIVATE KEY.');
  } else if (certificate && key && !certificate.checkPrivateKey(key)) {
    invalid.push("The private key doesn't match the pass certificate.");
  }

  if (apple.wwdrCertificate && !parseCertificate(apple.wwdrCertificate)) {
    invalid.push('The WWDR certificate must be a PEM certificate, starting with BEGIN CERTIFICATE.');
  }

  return { configured, missing, invalid, ready: configured && !missing.length && !invalid.length };
}

export function googleCheck(google = {}) {
  const configured = GOOGLE_FIELDS.some(([key]) => Boolean(google[key]));
  const missing = GOOGLE_FIELDS.filter(([key]) => !google[key]).map(([, label]) => label);
  const invalid = [];

  if (google.issuerId && !/^\d+$/.test(google.issuerId)) {
    invalid.push('The issuer ID is the number shown in the Google Pay & Wallet console.');
  }
  if (google.classId && !/^[A-Za-z0-9_.-]{1,100}$/.test(google.classId)) {
    invalid.push('The class ID can use only letters, digits, dots, dashes and underscores.');
  }
  if (google.serviceAccountKey) {
    let parsed = null;
    try {
      parsed = JSON.parse(google.serviceAccountKey);
    } catch {
      /* reported below */
    }
    if (!parsed?.client_email || !parsed?.private_key || !parsePrivateKey(parsed.private_key)) {
      invalid.push('The service account key must be the JSON key file from Google Cloud, with a client_email and private_key.');
    }
  }

  return { configured, missing, invalid, ready: configured && !missing.length && !invalid.length };
}

// Maps each wallet setting key to the field it sets, for the admin page's save.
export const WALLET_SETTING_FIELDS = {
  'wallet.apple.passTypeIdentifier': ['apple', 'passTypeIdentifier'],
  'wallet.apple.teamIdentifier': ['apple', 'teamIdentifier'],
  'wallet.apple.organizationName': ['apple', 'organizationName'],
  'wallet.apple.signingCertificate': ['apple', 'signingCertificate'],
  'wallet.apple.signingKey': ['apple', 'signingKey'],
  'wallet.apple.wwdrCertificate': ['apple', 'wwdrCertificate'],
  'wallet.google.issuerId': ['google', 'issuerId'],
  'wallet.google.classId': ['google', 'classId'],
  'wallet.google.serviceAccountKey': ['google', 'serviceAccountKey'],
  'wallet.design.backgroundColor': ['design', 'backgroundColor'],
  'wallet.design.foregroundColor': ['design', 'foregroundColor'],
  'wallet.design.labelColor': ['design', 'labelColor'],
  'wallet.design.primaryLabel': ['design', 'primaryLabel'],
  'wallet.design.primaryValue': ['design', 'primaryValue'],
  'wallet.design.backText': ['design', 'backText'],
  'wallet.design.iconPng': ['design', 'iconPng'],
};

// The wallet settings as they would be after saving `updates`. A key left out keeps its
// current value. A secret saved as '' is cleared, as the settings save does.
export function candidateWallet(current, updates) {
  const candidate = { apple: { ...current.apple }, google: { ...current.google }, design: { ...current.design } };
  for (const [key, [group, field]] of Object.entries(WALLET_SETTING_FIELDS)) {
    if (updates[key] === undefined) continue;
    const input = updates[key];
    candidate[group][field] = typeof input === 'string' ? input.trim() : '';
  }
  return candidate;
}

export function walletStatus(wallet) {
  return { apple: appleCheck(wallet.apple), google: googleCheck(wallet.google), design: designCheck(wallet.design) };
}
