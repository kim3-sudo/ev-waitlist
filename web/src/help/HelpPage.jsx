import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Box, Container, List, ListItemButton, ListItemText, ListSubheader, Paper, Typography } from '@mui/material';
import { useAuth } from '../context/AuthContext.jsx';
import { HELP_ARTICLES, HELP_SECTIONS } from './articles.jsx';

// Shows only the articles the signed-in user's permissions allow, grouped by section.
// On a wide screen the list and the article scroll independently, so the list stays in view.
export function HelpPage() {
  const { articleId } = useParams();
  const navigate = useNavigate();
  const { role, can } = useAuth();
  if (role === null) return null;

  const visible = HELP_ARTICLES.filter((article) => !article.permission || can(article.permission));
  const current = visible.find((article) => article.id === articleId) ?? visible[0];
  if (!current) return null;
  if (articleId !== current.id) return <Navigate to={`/help/${current.id}`} replace />;

  // Sections in their order, keeping only the articles this user can see. Any article
  // missing from a section goes last, so nothing disappears from the list.
  const placed = new Set();
  const sections = HELP_SECTIONS.map((section) => {
    const articles = section.ids.map((id) => visible.find((a) => a.id === id)).filter(Boolean);
    articles.forEach((a) => placed.add(a.id));
    return { title: section.title, articles };
  }).filter((section) => section.articles.length > 0);
  const leftovers = visible.filter((a) => !placed.has(a.id));
  if (leftovers.length) sections.push({ title: 'More', articles: leftovers });

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Typography variant="h5" fontWeight={600} sx={{ mb: 3 }}>
        Help
      </Typography>
      <Box
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', md: 'row' },
          gap: 3,
          alignItems: 'stretch',
          // A height that fits the window below the navbar, so the list and the article each
          // scroll on their own. It must not have a larger minimum: a box taller than the
          // window makes the whole page scroll and drags the topic list along with the navbar.
          height: { md: 'max(200px, calc(100dvh - var(--navbar-height, 64px) - 136px))' },
        }}
      >
        <Paper
          variant="outlined"
          component="nav"
          aria-label="Help topics"
          sx={{
            width: { xs: '100%', md: 280 },
            flexShrink: 0,
            overflowY: 'auto',
            maxHeight: { xs: 360, md: 'none' },
          }}
        >
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
              {section.articles.map((article) => (
                <ListItemButton
                  key={article.id}
                  selected={article.id === current.id}
                  aria-current={article.id === current.id ? 'page' : undefined}
                  onClick={() => navigate(`/help/${article.id}`)}
                  sx={{ py: 1, pl: 4 }}
                >
                  <ListItemText primary={article.title} slotProps={{ primary: { variant: 'body2' } }} />
                </ListItemButton>
              ))}
            </List>
          ))}
        </Paper>
        <Paper
          variant="outlined"
          component="article"
          sx={{
            flexGrow: 1,
            minWidth: 0,
            p: { xs: 2, sm: 3 },
            overflowY: 'auto',
          }}
        >
          <Typography variant="h5" fontWeight={600} gutterBottom>
            {current.title}
          </Typography>
          {current.body}
        </Paper>
      </Box>
    </Container>
  );
}
