import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './client.js';

// Loads a paginated list from the API. A page is { data, nextCursor }.
//
// Reloads (after an edit, or on a poll) keep every page already on screen, so the list
// does not jump back to the first page while someone is reading further down. A change
// to `params` starts again from the first page.
export function usePagedList(url, { params = {}, pageSize = 50, pollMs = 0, enabled = true } = {}) {
  const [items, setItems] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const pagesShown = useRef(1);
  const requestSeq = useRef(0);
  const paramsKey = JSON.stringify(params);

  const fetchPage = useCallback(
    (cursor) =>
      api
        .get(url, { params: { ...JSON.parse(paramsKey), limit: pageSize, ...(cursor ? { cursor } : {}) } })
        .then((res) => res.data),
    [url, paramsKey, pageSize],
  );

  const reload = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError('');
    try {
      const wanted = pagesShown.current;
      let cursor = null;
      let all = [];
      let next = null;
      let count = 0;
      do {
        const page = await fetchPage(cursor);
        if (seq !== requestSeq.current) return;
        all = all.concat(page.data);
        next = page.nextCursor;
        count += 1;
        cursor = next;
      } while (next && count < wanted);
      pagesShown.current = Math.max(1, count);
      setItems(all);
      setNextCursor(next);
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not load the list.');
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [fetchPage]);

  const loadMore = useCallback(async () => {
    if (!nextCursor) return;
    const seq = ++requestSeq.current;
    setLoading(true);
    try {
      const page = await fetchPage(nextCursor);
      if (seq !== requestSeq.current) return;
      setItems((prev) => [...prev, ...page.data]);
      setNextCursor(page.nextCursor);
      pagesShown.current += 1;
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not load more.');
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [nextCursor, fetchPage]);

  // A new filter or URL starts again from the first page.
  useEffect(() => {
    if (!enabled) return;
    pagesShown.current = 1;
    reload();
  }, [reload, enabled]);

  useEffect(() => {
    if (!pollMs || !enabled) return undefined;
    const id = setInterval(reload, pollMs);
    return () => clearInterval(id);
  }, [pollMs, reload, enabled]);

  return { items, setItems, hasMore: Boolean(nextCursor), loading, error, reload, loadMore };
}
