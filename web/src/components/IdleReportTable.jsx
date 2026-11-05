import { Table, TableHead, TableBody, TableRow, TableCell, Chip, Typography } from '@mui/material';

function formatDuration(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h} h ${m} min`;
}

export function IdleReportTable({ rows }) {
  return (
    <Table>
      <TableHead>
        <TableRow>
          <TableCell>Station</TableCell>
          <TableCell>Connector</TableCell>
          <TableCell>Idle since</TableCell>
          <TableCell>Idle for</TableCell>
          <TableCell>Status</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id} hover>
            <TableCell>{row.station.name}</TableCell>
            <TableCell>{row.connectorId}</TableCell>
            <TableCell>{new Date(row.startedAt).toLocaleString()}</TableCell>
            <TableCell>{formatDuration(row.durationMinutes)}</TableCell>
            <TableCell>
              {row.ongoing ? (
                <Chip size="small" label="Still idle" color={row.flagged ? 'error' : 'warning'} />
              ) : (
                <Chip size="small" label="Freed" color={row.flagged ? 'default' : 'success'} variant="outlined" />
              )}
            </TableCell>
          </TableRow>
        ))}
        {rows.length === 0 && (
          <TableRow>
            <TableCell colSpan={5}>
              <Typography color="text.secondary" sx={{ py: 2 }} align="center">
                No idle periods in this window.
              </Typography>
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
