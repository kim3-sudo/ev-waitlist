import { Accordion, AccordionDetails, AccordionSummary, Chip, Stack, Typography } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { ChargerList } from './ChargerList.jsx';
import { formatKw } from './locatorFormat.js';

// Sites, each holding its zones and their charge points.
export function SiteList({ sites, selectedId, onSelect, defaultExpanded = true }) {
  return (
    <Stack spacing={1}>
      {sites.map((site) => {
        const place = [site.address, site.city].filter(Boolean).join(', ');
        return (
          <Accordion key={site.id} defaultExpanded={defaultExpanded} disableGutters variant="outlined">
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Stack spacing={0.25} sx={{ minWidth: 0, pr: 2 }}>
                <Typography sx={{ fontWeight: 600 }}>{site.name}</Typography>
                {place && (
                  <Typography variant="body2" color="text.secondary" noWrap>
                    {place}
                  </Typography>
                )}
                <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', pt: 0.5 }}>
                  <Chip size="small" label={`${site.availableCount} of ${site.chargerCount} free`} color={site.availableCount ? 'success' : 'default'} />
                  <Chip size="small" variant="outlined" label={formatKw(site.maxKw)} />
                </Stack>
              </Stack>
            </AccordionSummary>
            <AccordionDetails sx={{ p: 2, pt: 0 }}>
              <Stack spacing={2}>
                {site.zones.map((zone) => (
                  <Stack key={zone.id ?? 'standalone'} spacing={1}>
                    {(site.zones.length > 1 || zone.id) && (
                      <Typography variant="subtitle2" color="text.secondary">
                        {zone.name}
                      </Typography>
                    )}
                    <ChargerList stations={zone.stations} selectedId={selectedId} onSelect={onSelect} />
                  </Stack>
                ))}
              </Stack>
            </AccordionDetails>
          </Accordion>
        );
      })}
    </Stack>
  );
}
