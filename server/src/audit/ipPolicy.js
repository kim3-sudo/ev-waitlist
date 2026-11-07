import net from 'node:net';

// How much of a client address an audit event keeps. Some places are not subject
// to GDPR, so the installation chooses:
//   FULL       the whole address
//   TRUNCATED  IPv4 to its /24 (last octet zeroed), IPv6 to its /48
//   NONE       no address at all
export const IP_LOGGING_LEVELS = ['FULL', 'TRUNCATED', 'NONE'];

// Expands an IPv6 address to its eight 16-bit groups.
function ipv6Groups(address) {
  const [head, tail] = address.split('::');
  const headParts = head ? head.split(':') : [];
  const tailParts = tail !== undefined && tail !== '' ? tail.split(':') : [];
  const missing = 8 - headParts.length - tailParts.length;
  const groups = [...headParts, ...Array(Math.max(0, missing)).fill('0'), ...tailParts];
  return groups.map((g) => Number.parseInt(g || '0', 16));
}

export function truncateIp(ip, level) {
  if (!ip || level === 'NONE') return null;
  if (level === 'FULL') return ip;
  // Unwrap IPv4 addresses shown in IPv6 form, such as ::ffff:203.0.113.9.
  const plain = ip.startsWith('::ffff:') && net.isIPv4(ip.slice(7)) ? ip.slice(7) : ip;
  if (net.isIPv4(plain)) {
    const parts = plain.split('.');
    return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
  }
  if (net.isIPv6(plain)) {
    // Keep the first 48 bits: three 16-bit groups.
    const [a, b, c] = ipv6Groups(plain.split('%')[0]);
    return `${a.toString(16)}:${b.toString(16)}:${c.toString(16)}::`;
  }
  // Not an address we recognise (for example a proxy header in some other form): keep nothing.
  return null;
}
