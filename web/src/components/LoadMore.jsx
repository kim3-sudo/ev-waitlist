import { Box, Button } from '@mui/material';

// The button under a paginated list. Renders nothing on the last page.
export function LoadMore({ hasMore, loading, onLoadMore }) {
  if (!hasMore) return null;
  return (
    <Box sx={{ textAlign: 'center', mt: 2 }}>
      <Button onClick={onLoadMore} disabled={loading}>
        {loading ? 'Loading…' : 'Load more'}
      </Button>
    </Box>
  );
}
