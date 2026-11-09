// The look of a pass: colours, the labels on the front, the text on the back, and the icon.
// The admin page saves these under wallet.design.*. An empty value uses the default here.

export const DESIGN_DEFAULTS = {
  backgroundColor: '#166534',
  foregroundColor: '#FFFFFF',
  labelColor: '#D1FAE5',
  primaryLabel: 'CHARGING PASS',
  primaryValue: 'Tap to charge',
  backText:
    'When it is your turn on the waitlist, tap this pass on the reader of the charge point you were offered. Your place in the waitlist is not shown here.',
};

export const ICON_SIZE = 58;
// Keeps the request that saves the icon under the server's JSON limit.
export const ICON_BASE64_MAX = 60000;

const HEX_COLOUR = /^#[0-9A-Fa-f]{6}$/;

// The design with defaults filled in, as the passes use it.
export function resolvedDesign(design = {}) {
  const pick = (key) => (design[key] ? design[key] : DESIGN_DEFAULTS[key]);
  return {
    backgroundColor: pick('backgroundColor'),
    foregroundColor: pick('foregroundColor'),
    labelColor: pick('labelColor'),
    primaryLabel: pick('primaryLabel'),
    primaryValue: pick('primaryValue'),
    backText: pick('backText'),
    iconPng: design.iconPng ? Buffer.from(design.iconPng, 'base64') : null,
  };
}

// Apple takes colours as rgb(r, g, b) text.
export function rgbText(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

// Reads a PNG's width and height from its header, or null if the bytes are not a PNG.
function pngSize(buf) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buf.length < 24 || !buf.subarray(0, 8).equals(signature)) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// Problems with the design values that would make a pass wrong. Empty values are fine.
export function designCheck(design = {}) {
  const invalid = [];
  for (const [key, label] of [
    ['backgroundColor', 'Background colour'],
    ['foregroundColor', 'Text colour'],
    ['labelColor', 'Label colour'],
  ]) {
    if (design[key] && !HEX_COLOUR.test(design[key])) invalid.push(`${label} must be a colour such as #166534.`);
  }
  if (design.primaryLabel && design.primaryLabel.length > 30) invalid.push('The front label can be at most 30 characters.');
  if (design.primaryValue && design.primaryValue.length > 40) invalid.push('The front text can be at most 40 characters.');
  if (design.backText && design.backText.length > 500) invalid.push('The back text can be at most 500 characters.');

  if (design.iconPng) {
    if (design.iconPng.length > ICON_BASE64_MAX) {
      invalid.push('The icon is too large. Use a plain PNG, 58 by 58 pixels.');
    } else {
      const size = pngSize(Buffer.from(design.iconPng, 'base64'));
      if (!size) invalid.push('The icon must be a PNG image.');
      else if (size.width !== ICON_SIZE || size.height !== ICON_SIZE) {
        invalid.push(`The icon must be ${ICON_SIZE} by ${ICON_SIZE} pixels, not ${size.width} by ${size.height}.`);
      }
    }
  }
  return { invalid };
}
