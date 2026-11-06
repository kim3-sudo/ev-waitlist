// OCPI 2.2.1 response envelope and status codes.
// Every response is { status_code, status_message, timestamp, data? }.

export const STATUS = {
  SUCCESS: 1000,
  CLIENT_ERROR: 2000,
  INVALID_PARAMETERS: 2001,
  NOT_ENOUGH_INFO: 2002,
  UNKNOWN_LOCATION: 2003,
  SERVER_ERROR: 3000,
  UNSUPPORTED_VERSION: 3001,
  NO_ENDPOINTS: 3002,
  UNABLE_TO_USE_CLIENT: 3003,
};

export function ocpiTimestamp(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function ok(res, data, status = 200) {
  return res.status(status).json({
    status_code: STATUS.SUCCESS,
    status_message: 'Success',
    timestamp: ocpiTimestamp(),
    data,
  });
}

// OCPI errors are HTTP 200 with an OCPI status code, except for transport-level
// refusals, which use the HTTP status as well.
export function fail(res, httpStatus, ocpiCode, message) {
  return res.status(httpStatus).json({
    status_code: ocpiCode,
    status_message: message,
    timestamp: ocpiTimestamp(),
  });
}

// Pagination by offset and limit, with the headers OCPI requires on list responses.
export function paginate(req, res, items, { defaultLimit = 100, maxLimit = 500 } = {}) {
  const offset = Math.max(0, Number.parseInt(req.query.offset ?? '0', 10) || 0);
  const limit = Math.min(maxLimit, Math.max(1, Number.parseInt(req.query.limit ?? String(defaultLimit), 10) || defaultLimit));
  const page = items.slice(offset, offset + limit);
  res.set('X-Total-Count', String(items.length));
  res.set('X-Limit', String(limit));
  if (offset + limit < items.length) {
    const next = new URL(req.originalUrl, 'http://placeholder');
    next.searchParams.set('offset', String(offset + limit));
    next.searchParams.set('limit', String(limit));
    res.set('Link', `<${next.pathname}${next.search}>; rel="next"`);
  }
  return page;
}
