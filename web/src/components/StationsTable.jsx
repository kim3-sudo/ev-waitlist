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
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import DeleteIcon from '@mui/icons-material/Delete';
import { ocppStatusLabel, ocppStatusDescription } from '../ocppStatus.js';

export function StationsTable({ stations, onEdit, onDelete, onStatus, readOnly = false }) {
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
          {(!readOnly || onStatus) && <TableCell align="right">Actions</TableCell>}
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
              <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
                <Chip size="small" label={station.online ? 'Online' : 'Offline'} color={station.online ? 'success' : 'default'} />
                {station.faulted && <Chip size="small" color="error" label="Fault" />}
                {station.meterStatus === 'NONE' && <Chip size="small" color="warning" variant="outlined" label="No meter" />}
              </Stack>
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
            {(!readOnly || onStatus) && (
              <TableCell align="right">
                {onStatus && (
                  <IconButton size="small" onClick={() => onStatus(station)} aria-label="Status">
                    <InfoOutlinedIcon fontSize="small" />
                  </IconButton>
                )}
                {!readOnly && (
                  <>
                    <IconButton size="small" onClick={() => onEdit(station)} aria-label="Edit">
                      <EditIcon fontSize="small" />
                    </IconButton>
                    <IconButton size="small" onClick={() => onDelete(station)} aria-label="Delete" color="error">
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </>
                )}
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
