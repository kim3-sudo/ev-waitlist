import { Table, TableHead, TableBody, TableRow, TableCell, Chip, Button, Stack, Typography } from '@mui/material';

const STATUS_COLOR = {
  OPEN: 'warning',
  RESOLVED: 'success',
  DISMISSED: 'default',
};

export function LineCutterReportsTable({ reports, onUpdateStatus }) {
  return (
    <Table>
      <TableHead>
        <TableRow>
          <TableCell>Reported</TableCell>
          <TableCell>Station</TableCell>
          <TableCell>Reported by</TableCell>
          <TableCell>Note</TableCell>
          <TableCell>Status</TableCell>
          <TableCell align="right">Actions</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {reports.map((report) => (
          <TableRow key={report.id} hover>
            <TableCell>{new Date(report.createdAt).toLocaleString()}</TableCell>
            <TableCell>{report.station.name}</TableCell>
            <TableCell>
              <Typography variant="body2">{report.queueEntry.name}</Typography>
              <Typography variant="caption" color="text.secondary">
                {report.queueEntry.contact}
              </Typography>
            </TableCell>
            <TableCell sx={{ maxWidth: 280 }}>{report.note || '—'}</TableCell>
            <TableCell>
              <Chip size="small" label={report.status} color={STATUS_COLOR[report.status] ?? 'default'} />
            </TableCell>
            <TableCell align="right">
              {report.status === 'OPEN' && (
                <Stack direction="row" spacing={1} justifyContent="flex-end">
                  <Button size="small" onClick={() => onUpdateStatus(report.id, 'DISMISSED')}>
                    Dismiss
                  </Button>
                  <Button size="small" variant="contained" onClick={() => onUpdateStatus(report.id, 'RESOLVED')}>
                    Mark resolved
                  </Button>
                </Stack>
              )}
            </TableCell>
          </TableRow>
        ))}
        {reports.length === 0 && (
          <TableRow>
            <TableCell colSpan={6}>
              <Typography color="text.secondary" sx={{ py: 2 }} align="center">
                No line-cutter reports.
              </Typography>
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
