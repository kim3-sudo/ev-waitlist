import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Box, Container, Paper, Tab, Tabs, Typography } from '@mui/material';
import { useAuth } from '../context/AuthContext.jsx';
import { HELP_ARTICLES } from './articles.jsx';

// Shows only the articles the signed-in user's permissions allow.
export function HelpPage() {
  const { articleId } = useParams();
  const navigate = useNavigate();
  const { role, can } = useAuth();
  if (role === null) return null;

  const visible = HELP_ARTICLES.filter((article) => !article.permission || can(article.permission));
  const current = visible.find((article) => article.id === articleId) ?? visible[0];
  if (!current) return null;
  if (articleId !== current.id) return <Navigate to={`/help/${current.id}`} replace />;

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Typography variant="h5" fontWeight={600} sx={{ mb: 3 }}>
        Help
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 3, alignItems: 'flex-start' }}>
        <Paper variant="outlined" sx={{ width: { xs: '100%', md: 240 }, flexShrink: 0 }}>
          <Tabs
            orientation="vertical"
            variant="scrollable"
            value={current.id}
            onChange={(_, id) => navigate(`/help/${id}`)}
            sx={{ borderRight: 1, borderColor: 'divider', '& .MuiTab-root': { alignItems: 'flex-start', textAlign: 'left' } }}
          >
            {visible.map((article) => (
              <Tab key={article.id} label={article.title} value={article.id} />
            ))}
          </Tabs>
        </Paper>
        <Paper variant="outlined" sx={{ flexGrow: 1, p: { xs: 2, sm: 3 }, minWidth: 0 }} component="article">
          <Typography variant="h5" fontWeight={600} gutterBottom>
            {current.title}
          </Typography>
          {current.body}
        </Paper>
      </Box>
    </Container>
  );
}
