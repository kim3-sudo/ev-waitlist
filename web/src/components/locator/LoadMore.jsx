import { useEffect, useRef } from 'react';
import { Button, Stack, Typography } from '@mui/material';

// The foot of a list that loads in pages. When it scrolls into view, the next page loads; a
// button does the same for anyone who prefers it.
export function LoadMore({ hasMore, loading, onLoadMore, shown, total, noun }) {
  const node = useRef(null);
  const onLoadMoreRef = useRef(onLoadMore);
  useEffect(() => {
    onLoadMoreRef.current = onLoadMore;
  });

  // Watches again after each page, so a short screen keeps filling until the foot is out of view.
  useEffect(() => {
    const el = node.current;
    if (!hasMore || !el || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) onLoadMoreRef.current();
      },
      { rootMargin: '300px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loading, shown]);

  return (
    <Stack ref={node} spacing={1} sx={{ alignItems: 'center', py: 1.5 }}>
      <Typography variant="body2" color="text.secondary">
        Showing {shown} of {total} {noun}
      </Typography>
      {hasMore && (
        <Button size="small" variant="outlined" onClick={onLoadMore} disabled={loading}>
          {loading ? 'Loading more…' : 'Show more'}
        </Button>
      )}
    </Stack>
  );
}
