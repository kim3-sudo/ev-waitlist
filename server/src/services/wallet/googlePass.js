import jwt from 'jsonwebtoken';
import { resolvedDesign } from './design.js';

// Google Wallet "save" links. The link carries a JWT, signed with the service account's key,
// that describes one generic pass in the operator's class. The driver opens the link on a phone
// and Google adds the pass to their wallet.
const SAVE_URL = 'https://pay.google.com/gp/v/save/';

// `google` is the output of googleCredentials(). `origin` is the site's web address, which
// Google requires in the token so the link can only be used from there.
export function googleSaveUrl(google, serial, { origin, design = {} }) {
  const look = resolvedDesign(design);
  const token = jwt.sign(
    {
      iss: google.clientEmail,
      aud: 'google',
      typ: 'savetowallet',
      iat: Math.floor(Date.now() / 1000),
      origins: origin ? [origin] : [],
      payload: {
        genericObjects: [
          {
            id: `${google.issuerId}.${serial}`,
            classId: `${google.issuerId}.${google.classId}`,
            state: 'ACTIVE',
            hexBackgroundColor: look.backgroundColor,
            cardTitle: { defaultValue: { language: 'en-US', value: look.primaryLabel } },
            header: { defaultValue: { language: 'en-US', value: look.primaryValue } },
            // The value a Smart Tap reader reads. Smart Tap needs Google's approval on the class.
            smartTapRedemptionValue: serial,
          },
        ],
      },
    },
    google.privateKey,
    { algorithm: 'RS256' },
  );
  return SAVE_URL + token;
}
