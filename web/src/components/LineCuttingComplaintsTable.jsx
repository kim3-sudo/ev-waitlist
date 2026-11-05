import { Table, TableHead, TableBody, TableRow, TableCell, Chip, Button, Stack, Typography } from '@mui/material';

const STATUS_COLOR = {
  OPEN: 'warning',
  RESOLVED: 'success',
  DISMISSED: 'default',
};

export function LineCuttingComplaintsTable({ complaints, onUpdateStatus, readOnly = false }) {
  const columns = readOnly ? 5 : 6;
  return (
    <Table>
      <TableHead>
        <TableRow>
          <TableCell>Filed</TableCell>
          <TableCell>Station</TableCell>
          <TableCell>Filed by</TableCell>
          <TableCell>Note</TableCell>
          <TableCell>Status</TableCell>
          {!readOnly && <TableCell align="right">Actions</TableCell>}
        </TableRow>
      </TableHead>
      <TableBody>
        {complaints.map((complaint) => (
          <TableRow key={complaint.id} hover>
            <TableCell>{new Date(complaint.createdAt).toLocaleString()}</TableCell>
            <TableCell>{complaint.station.name}</TableCell>
            <TableCell>
              <Typography variant="body2">{complaint.queueEntry.name}</Typography>
              <Typography variant="caption" color="text.secondary">
                {complaint.queueEntry.contact}
              </Typography>
            </TableCell>
            <TableCell sx={{ maxWidth: 280 }}>{complaint.note || '—'}</TableCell>
            <TableCell>
              <Chip size="small" label={complaint.status} color={STATUS_COLOR[complaint.status] ?? 'default'} />
            </TableCell>
            {!readOnly && (
              <TableCell align="right">
                {complaint.status === 'OPEN' && (
                  <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                    <Button size="small" onClick={() => onUpdateStatus(complaint.id, 'DISMISSED')}>
                      Dismiss
                    </Button>
                    <Button size="small" variant="contained" onClick={() => onUpdateStatus(complaint.id, 'RESOLVED')}>
                      Mark resolved
                    </Button>
                  </Stack>
                )}
              </TableCell>
            )}
          </TableRow>
        ))}
        {complaints.length === 0 && (
          <TableRow>
            <TableCell colSpan={columns}>
              <Typography color="text.secondary" sx={{ py: 2 }} align="center">
                No line-cutting complaints.
              </Typography>
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
