import { createHash } from 'node:crypto';
import { rawPrisma } from '../db.js';

// Hash chain over the audit log. Each row stores prevHash (the hash of the row before it)
// and hash (a SHA-256 over its own fields plus prevHash). Editing or deleting a row in the
// middle breaks the link to the next row, and changing a row's fields breaks its own hash.
//
// Retention removes the oldest rows. The oldest remaining row then becomes the anchor:
// its link to the removed rows can't be checked, but its own hash still can.

export const GENESIS_HASH = '0'.repeat(64);

// The fields covered by the hash, in a fixed order. Changing this list breaks every existing chain.
const HASHED_FIELDS = [
  'seq', 'at', 'tenantId', 'actorType', 'actorId', 'actorLabel', 'action',
  'targetType', 'targetId', 'targetLabel', 'outcome', 'reason', 'changes',
  'ip', 'userAgent', 'requestId', 'prevHash',
];

function canonicalValue(field, value) {
  if (value === undefined || value === null) return null;
  if (field === 'at') return new Date(value).toISOString();
  return value;
}

export function hashEvent(row) {
  const values = HASHED_FIELDS.map((field) => canonicalValue(field, row[field]));
  return createHash('sha256').update(JSON.stringify(values)).digest('hex');
}

// Walks the chain in order and reports the first problem, or ok. Reads in batches so a
// long log doesn't have to fit in memory.
export async function verifyChain({ batchSize = 500 } = {}) {
  let lastSeq = null;
  let lastHash = null;
  let anchorSeq = null;
  let checked = 0;
  let afterSeq = 0;

  for (;;) {
    const rows = await rawPrisma.auditEvent.findMany({
      where: { seq: { gt: afterSeq } },
      orderBy: { seq: 'asc' },
      take: batchSize,
    });
    if (rows.length === 0) break;

    for (const row of rows) {
      if (anchorSeq === null) {
        anchorSeq = row.seq;
      } else if (row.seq !== lastSeq + 1) {
        return { ok: false, checked, anchorSeq, problem: 'MISSING_ROWS', atSeq: row.seq, expectedSeq: lastSeq + 1 };
      } else if (row.prevHash !== lastHash) {
        return { ok: false, checked, anchorSeq, problem: 'LINK_BROKEN', atSeq: row.seq };
      }
      if (hashEvent(row) !== row.hash) {
        return { ok: false, checked, anchorSeq, problem: 'ROW_CHANGED', atSeq: row.seq };
      }
      lastSeq = row.seq;
      lastHash = row.hash;
      checked += 1;
    }
    afterSeq = lastSeq;
  }

  return { ok: true, checked, anchorSeq, lastSeq, lastHash };
}
