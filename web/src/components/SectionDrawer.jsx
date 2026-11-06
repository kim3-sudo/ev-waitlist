import { Box, Drawer, List, ListItemButton, ListItemText, ListSubheader, MenuItem, TextField } from '@mui/material';

export const DRAWER_WIDTH = 240;

// A permanent drawer of sections and their pages. Sections are groups such as "Payments"
// with the pages inside them. On narrow screens, the same pages are a menu above the
// content, because a side drawer would take up the whole phone screen.
//
// sections: [{ title, items: [{ label, path }] }]
// currentPath: the path of the page on screen.
export function SectionDrawer({ sections, currentPath, onNavigate, label, children }) {
  const items = sections.flatMap((section) => section.items);
  const selected = items.some((item) => item.path === currentPath) ? currentPath : '';

  return (
    <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, alignItems: 'flex-start' }}>
      <Drawer
        variant="permanent"
        aria-label={label}
        sx={{
          // The drawer is pinned to the top of the window while the content scrolls, and it
          // scrolls its own list when the list is longer than the window.
          display: { xs: 'none', md: 'block' },
          position: 'sticky',
          top: 0,
          alignSelf: 'flex-start',
          width: DRAWER_WIDTH,
          flexShrink: 0,
          height: 'calc(100dvh - 64px)',
          '& .MuiDrawer-paper': {
            position: 'relative',
            width: DRAWER_WIDTH,
            boxSizing: 'border-box',
            height: '100%',
            overflowY: 'auto',
            overscrollBehavior: 'contain',
            borderRight: 1,
            borderColor: 'divider',
          },
        }}
      >
        <Box component="nav" aria-label={label}>
          {sections.map((section) => (
            <List
              key={section.title}
              dense
              disablePadding
              subheader={
                <ListSubheader sx={{ lineHeight: '36px', fontWeight: 600, bgcolor: 'background.paper' }}>
                  {section.title}
                </ListSubheader>
              }
            >
              {section.items.map((item) => (
                <ListItemButton
                  key={item.path}
                  selected={item.path === selected}
                  aria-current={item.path === selected ? 'page' : undefined}
                  onClick={() => onNavigate(item.path)}
                  sx={{ py: 1, pl: 3 }}
                >
                  <ListItemText primary={item.label} slotProps={{ primary: { variant: 'body2' } }} />
                </ListItemButton>
              ))}
            </List>
          ))}
        </Box>
      </Drawer>

      <Box sx={{ display: { xs: 'block', md: 'none' }, width: '100%', px: 2, pt: 2 }}>
        <TextField
          select
          fullWidth
          size="small"
          label={label}
          value={selected}
          onChange={(e) => onNavigate(e.target.value)}
        >
          {sections.flatMap((section) => [
            <ListSubheader key={`h-${section.title}`}>{section.title}</ListSubheader>,
            ...section.items.map((item) => (
              <MenuItem key={item.path} value={item.path}>
                {item.label}
              </MenuItem>
            )),
          ])}
        </TextField>
      </Box>

      <Box component="main" sx={{ flexGrow: 1, minWidth: 0 }}>
        {children}
      </Box>
    </Box>
  );
}
