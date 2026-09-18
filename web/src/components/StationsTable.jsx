import {
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Chip,
  IconButton,
  Stack,
  Typography,
  Tooltip,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import { ocppStatusLabel, ocppStatusDescription } from '../ocppStatus.js';

export function StationsTable({ stations, onEdit, onDelete }) {
  return (
    <Table>
      <TableHead>
        <TableRow>
          <TableCell>Name</TableCell>
          <TableCell>Identity</TableCell>
          <TableCell>Location</TableCell>
          <TableCell>Zone</TableCell>
          <TableCell>Status</TableCell>
          <TableCell>Connectors</TableCell>
          <TableCell align="right">Actions</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {stations.map((station) => (
          <TableRow key={station.id} hover>
            <TableCell>{station.name}</TableCell>
            <TableCell>
              <Typography variant="body2" fontFamily="monospace">
                {station.identity}
              </Typography>
            </TableCell>
            <TableCell>{station.location || '—'}</TableCell>
            <TableCell>{station.zoneName || '—'}</TableCell>
            <TableCell>
              <Chip
                size="small"
                label={station.online ? 'Online' : 'Offline'}
                color={station.online ? 'success' : 'default'}
              />
            </TableCell>
            <TableCell>
              <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
                {station.connectors.map((c) => (
                  <Tooltip key={c.connectorId} title={ocppStatusDescription(c.status, 'cpo') ?? ''} arrow>
                    <Chip
                      size="small"
                      variant="outlined"
                      label={`#${c.connectorId} ${ocppStatusLabel(c.status)}`}
                    />
                  </Tooltip>
                ))}
              </Stack>
            </TableCell>
            <TableCell align="right">
              <IconButton size="small" onClick={() => onEdit(station)} aria-label="Edit">
                <EditIcon fontSize="small" />
              </IconButton>
              <IconButton size="small" onClick={() => onDelete(station)} aria-label="Delete" color="error">
                <DeleteIcon fontSize="small" />
              </IconButton>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
