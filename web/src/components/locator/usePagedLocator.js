import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import { useLive } from '../../api/live.js';

// The charge point models that change availability and price shown on the locator.
const LOCATOR_LIVE_MODELS = ['station', 'connector', 'reservation', 'queueEntry'];

const EMPTY = { items: [], scope: null, count: 0, total: 0, hasMore: false, loading: true, error: null };

// Loads one page of charge points or sites from the locator, and more pages on request.
// `query` holds the filters. `resetKey` names what the results are for (the view and the
// filters): when it changes, the list starts again from the top and no earlier items show.
// Replies for an earlier query are dropped. The first page refreshes when the server announces
// a change, and keeps as many items as are already on screen.
export function usePagedLocator({ path, itemsKey, query, pageSize, resetKey }) {
  const queryKey = JSON.stringify(query);
  const scope = `${path}|${resetKey}`;
  const [state, setState] = useState(EMPTY);
  const [loadingMore, setLoadingMore] = useState(false);
  const generation = useRef(0);
  const loaded = useRef(0);
  const busy = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  const fetchPage = useCallback(
    (offset, limit, append) => {
      const gen = generation.current;
      const params = { ...JSON.parse(queryKey), offset, limit };
      return api
        .get(path, { params })
        .then(({ data }) => {
          if (gen !== generation.current) return;
          const incoming = data[itemsKey] ?? [];
          loaded.current = append ? offset + incoming.length : incoming.length;
          setState((prev) => ({
            items: append && prev.scope === scope ? [...prev.items, ...incoming] : incoming,
            scope,
            count: data.count ?? 0,
            total: data.total ?? 0,
            hasMore: Boolean(data.hasMore),
            loading: false,
            error: null,
          }));
        })
        .catch(() => {
          if (gen !== generation.current) return;
          setState((prev) => ({ ...prev, scope, loading: false, error: 'Charge points could not be loaded. Try again in a moment.' }));
        });
    },
    [path, itemsKey, queryKey, scope],
  );

  // A new query: the first page again.
  useEffect(() => {
    generation.current += 1;
    loaded.current = 0;
    fetchPage(0, pageSize, false);
  }, [fetchPage, pageSize]);

  // Availability changes while a driver waits, so the loaded items refresh when it does.
  useLive('/api/locator/live', LOCATOR_LIVE_MODELS, () => fetchPage(0, Math.max(pageSize, loaded.current), false));

  const loadMore = useCallback(() => {
    if (busy.current || !stateRef.current.hasMore) return;
    busy.current = true;
    setLoadingMore(true);
    fetchPage(loaded.current, pageSize, true).finally(() => {
      busy.current = false;
      setLoadingMore(false);
    });
  }, [fetchPage, pageSize]);

  // Items from another query are not shown while the new one loads.
  const current = state.scope === scope;
  return {
    items: current ? state.items : [],
    count: current ? state.count : 0,
    total: current ? state.total : 0,
    hasMore: current && state.hasMore,
    loading: !current || state.loading,
    loadingMore,
    error: state.error,
    loadMore,
  };
}
