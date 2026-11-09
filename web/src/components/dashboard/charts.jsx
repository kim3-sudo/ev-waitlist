import { Box, Stack, Typography, useTheme } from '@mui/material';

// Charts for the admin dashboard. Plain SVG and CSS, so no charting library is needed.
// Colors come from the data-viz reference palette: blue and orange for the two data
// series, status colors (good, warning, serious, critical) for state, and neutral
// grays for the rest. Every chart has a text value or legend, so color is never the
// only cue.

const PALETTE = {
  light: {
    blue: '#2a78d6',
    orange: '#eb6834',
    good: '#0ca30c',
    warning: '#fab219',
    critical: '#d03b3b',
    violet: '#6250d6',
    muted: '#898781',
    neutral: '#c3c2b7',
    hairline: '#e1e0d9',
    secondary: '#52514e',
  },
  dark: {
    blue: '#3987e5',
    orange: '#d95926',
    good: '#0ca30c',
    warning: '#fab219',
    critical: '#d03b3b',
    violet: '#9085e9',
    muted: '#898781',
    neutral: '#383835',
    hairline: '#2c2c2a',
    secondary: '#c3c2b7',
  },
};

export function useChartColors() {
  const theme = useTheme();
  return PALETTE[theme.palette.mode === 'dark' ? 'dark' : 'light'];
}

export const percentText = (value) => (value == null ? '—' : `${value}%`);

// A legend row: colored swatch (or icon) plus a text label. Always shown with 2+ series.
export function Legend({ items }) {
  return (
    <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 1.5, mt: 1 }}>
      {items.map((item) => (
        <Stack key={item.label} direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
          <Box aria-hidden sx={{ width: 10, height: 10, borderRadius: '2px', bgcolor: item.color, flexShrink: 0 }} />
          <Typography variant="caption" color="text.secondary">
            {item.label}
            {item.value != null ? ` ${item.value}` : ''}
          </Typography>
        </Stack>
      ))}
    </Stack>
  );
}

// One horizontal segmented bar: each segment is a share of the whole. Used for connector
// states and for the charging, waiting and free split. Gaps keep neighboring segments
// apart; each segment has a hover title.
export function SegmentedBar({ segments, height = 18 }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const colors = useChartColors();
  return (
    <Box
      role="img"
      aria-label={segments.map((s) => `${s.label} ${s.value}`).join(', ')}
      sx={{ display: 'flex', gap: '2px', width: '100%', height, borderRadius: '4px', overflow: 'hidden', bgcolor: colors.hairline }}
    >
      {total > 0 &&
        segments
          .filter((s) => s.value > 0)
          .map((s) => (
            <Box
              key={s.label}
              title={`${s.label}: ${s.value}`}
              sx={{ flexGrow: s.value, flexBasis: 0, bgcolor: s.color, minWidth: 4 }}
            />
          ))}
    </Box>
  );
}

// A ring showing the share of online and offline stations.
export function Donut({ parts, size = 120, stroke = 16, center }) {
  const colors = useChartColors();
  const total = parts.reduce((sum, p) => sum + p.value, 0);
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <Box sx={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={parts.map((p) => `${p.label} ${p.value}`).join(', ')}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={colors.hairline} strokeWidth={stroke} />
        {total > 0 &&
          parts
            .filter((p) => p.value > 0)
            .map((p) => {
              const length = (p.value / total) * circumference;
              const gap = parts.length > 1 ? 2 : 0;
              const circle = (
                <circle
                  key={p.label}
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  fill="none"
                  stroke={p.color}
                  strokeWidth={stroke}
                  strokeDasharray={`${Math.max(0, length - gap)} ${circumference}`}
                  strokeDashoffset={-offset}
                  transform={`rotate(-90 ${size / 2} ${size / 2})`}
                >
                  <title>{`${p.label}: ${p.value}`}</title>
                </circle>
              );
              offset += length;
              return circle;
            })}
      </svg>
      {center && (
        <Box sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          {center}
        </Box>
      )}
    </Box>
  );
}

// One row per station with a horizontal bar, for a value from 0 to 100 percent.
// Stations with no value (no time in the window) show a dash.
export function PercentBars({ rows, color, emptyText = 'No stations yet.' }) {
  const colors = useChartColors();
  if (!rows.length) {
    return <Typography variant="body2" color="text.secondary">{emptyText}</Typography>;
  }
  return (
    <Stack spacing={1}>
      {rows.map((row) => (
        <Box key={row.id} sx={{ display: 'grid', gridTemplateColumns: 'minmax(96px, 180px) 1fr 56px', gap: 1.5, alignItems: 'center' }}>
          <Typography variant="body2" noWrap title={row.name}>
            {row.name}
          </Typography>
          <Box
            title={`${row.name}: ${percentText(row.value)}`}
            sx={{ height: 14, borderRadius: '4px', bgcolor: colors.hairline, position: 'relative', overflow: 'hidden' }}
          >
            {row.value != null && (
              <Box
                sx={{
                  height: '100%',
                  width: `${Math.min(100, Math.max(0, row.value))}%`,
                  bgcolor: color,
                  borderRadius: '4px',
                  minWidth: row.value > 0 ? 4 : 0,
                }}
              />
            )}
          </Box>
          <Typography variant="body2" sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
            {percentText(row.value)}
          </Typography>
        </Box>
      ))}
    </Stack>
  );
}

// Columns for a daily series (revenue per day). Each column has a hover title. The
// largest column is labeled and the axis shows the top value.
export function DailyColumns({ data, format, height = 160 }) {
  const colors = useChartColors();
  if (!data.length) {
    return <Typography variant="body2" color="text.secondary">No payments in this period yet.</Typography>;
  }
  const max = Math.max(...data.map((d) => d.value), 0);
  const peak = data.reduce((best, d) => (d.value > best.value ? d : best), data[0]);
  return (
    <Box>
      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'flex-end', height, borderBottom: `1px solid ${colors.neutral}` }}>
        {data.map((d) => (
          <Box
            key={d.label}
            title={`${d.label}: ${format(d.value)}`}
            sx={{
              flex: 1,
              minWidth: 4,
              maxWidth: 24,
              height: max > 0 ? `${(d.value / max) * 100}%` : 0,
              minHeight: d.value > 0 ? 3 : 0,
              bgcolor: colors.blue,
              borderRadius: '4px 4px 0 0',
              position: 'relative',
            }}
          />
        ))}
      </Stack>
      <Stack direction="row" sx={{ justifyContent: 'space-between', mt: 0.5 }}>
        <Typography variant="caption" color="text.secondary">
          {data[0].label}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Peak {format(peak.value)} on {peak.label}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {data[data.length - 1].label}
        </Typography>
      </Stack>
    </Box>
  );
}

// A number tile: a label, a large value and an optional line of context.
export function StatTile({ label, value, detail, icon, color }) {
  return (
    <Box sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 2, minWidth: 0 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        {icon && (
          <Box aria-hidden sx={{ color, display: 'flex' }}>
            {icon}
          </Box>
        )}
        <Typography variant="body2" color="text.secondary" noWrap>
          {label}
        </Typography>
      </Stack>
      <Typography variant="h5" fontWeight={600} sx={{ mt: 0.5 }}>
        {value}
      </Typography>
      {detail && (
        <Typography variant="caption" color="text.secondary">
          {detail}
        </Typography>
      )}
    </Box>
  );
}

// A titled panel for one part of the dashboard.
export function Panel({ title, subtitle, children, sx }) {
  return (
    <Box sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 2, minWidth: 0, ...sx }}>
      <Typography variant="subtitle1" fontWeight={600}>
        {title}
      </Typography>
      {subtitle && (
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1.5 }}>
          {subtitle}
        </Typography>
      )}
      {children}
    </Box>
  );
}
