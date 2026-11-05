import { Table, TableHead, TableBody, TableRow, TableCell, Typography } from '@mui/material';

function formatHours(hours) {
  if (hours === null || hours === undefined) return '—';
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  return `${hours} h`;
}

export function ComplaintsSummaryTable({ rows }) {
  return (
    <Table>
      <TableHead>
        <TableRow>
          <TableCell>Station</TableCell>
          <TableCell align="right">Total</TableCell>
          <TableCell align="right">Open</TableCell>
          <TableCell align="right">Resolved</TableCell>
          <TableCell align="right">Dismissed</TableCell>
          <TableCell align="right">Avg. time to resolve</TableCell>
          <TableCell align="right">Oldest open</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.station.id} hover>
            <TableCell>{row.station.name}</TableCell>
            <TableCell align="right">{row.total}</TableCell>
            <TableCell align="right">{row.open}</TableCell>
            <TableCell align="right">{row.resolved}</TableCell>
            <TableCell align="right">{row.dismissed}</TableCell>
            <TableCell align="right">{formatHours(row.averageHoursToResolve)}</TableCell>
            <TableCell align="right">{row.open > 0 ? formatHours(row.oldestOpenHours) : '—'}</TableCell>
          </TableRow>
        ))}
        {rows.length === 0 && (
          <TableRow>
            <TableCell colSpan={7}>
              <Typography color="text.secondary" sx={{ py: 2 }} align="center">
                No complaints in this window.
              </Typography>
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
