// Cursor (keyset) pagination for list endpoints. A page is { data, nextCursor }.
// nextCursor is null on the last page. The cursor encodes the sort position of the last
// row returned, so rows inserted or removed between pages neither repeat nor skip rows.

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

// Reads ?limit. Returns { value } or { error }.
export function readLimit(query, { defaultLimit = DEFAULT_LIMIT } = {}) {
  if (query.limit === undefined || query.limit === '') return { value: defaultLimit };
  const n = Number(query.limit);
  if (!Number.isInteger(n) || n < 1) return { error: `limit must be a whole number from 1 to ${MAX_LIMIT}` };
  return { value: Math.min(n, MAX_LIMIT) };
}

export function encodeCursor(position) {
  return Buffer.from(JSON.stringify(position), 'utf8').toString('base64url');
}

// Returns the decoded position, or null if the cursor is not one we issued.
export function decodeCursor(text) {
  if (typeof text !== 'string' || text === '') return null;
  try {
    const value = JSON.parse(Buffer.from(text, 'base64url').toString('utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

// Takes one row more than the page size from the database. Its presence means there is another page.
export function pageOf(rows, limit, positionOf) {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  return {
    data,
    nextCursor: hasMore ? encodeCursor(positionOf(data[data.length - 1])) : null,
  };
}

// Where clause for "after this position" in a list sorted by (field, id). Rows come after
// the cursor's row in the given direction ('desc' or 'asc'). Set date for a DateTime field,
// whose cursor value is an ISO string.
export function afterPosition(position, field, { direction = 'desc', date = false } = {}) {
  if (!position) return {};
  const op = direction === 'desc' ? 'lt' : 'gt';
  const value = date ? new Date(position.v) : position.v;
  if (date && Number.isNaN(value.getTime())) return {};
  return {
    OR: [{ [field]: { [op]: value } }, { [field]: value, id: { [op]: position.i } }],
  };
}

// Reads ?limit and ?cursor together. Returns { limit, position } or { error }.
export function readPageRequest(query, options) {
  const limit = readLimit(query, options);
  if (limit.error) return { error: limit.error };
  let position = null;
  if (query.cursor) {
    position = decodeCursor(query.cursor);
    if (!position || position.v === undefined || typeof position.i !== 'string') {
      return { error: 'The cursor is not valid' };
    }
  }
  return { limit: limit.value, position };
}
