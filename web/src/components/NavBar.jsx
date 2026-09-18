import { AppBar, Toolbar, Typography, Button, Stack, Avatar } from '@mui/material';
import EvStationIcon from '@mui/icons-material/EvStation';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useSettings } from '../context/SettingsContext.jsx';

export function NavBar() {
  const { isAuthenticated, email, logout } = useAuth();
  const { settings } = useSettings();
  const navigate = useNavigate();

  return (
    <AppBar position="static" color="primary" elevation={0}>
      <Toolbar>
        {settings.logoUrl ? (
          <Avatar src={settings.logoUrl} variant="rounded" sx={{ mr: 1, width: 32, height: 32 }} />
        ) : (
          <EvStationIcon sx={{ mr: 1 }} />
        )}
        <Typography
          variant="h6"
          component={RouterLink}
          to="/"
          sx={{ flexGrow: 1, color: 'inherit', textDecoration: 'none', fontWeight: 600 }}
        >
          {settings.companyName}
        </Typography>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Button component={RouterLink} to="/" color="inherit">
            Waitlist
          </Button>
          {isAuthenticated ? (
            <>
              <Button component={RouterLink} to="/admin" color="inherit">
                Admin
              </Button>
              <Button component={RouterLink} to="/account" color="inherit" sx={{ opacity: 0.85, fontSize: 14 }}>
                {email}
              </Button>
              <Button
                color="inherit"
                variant="outlined"
                onClick={() => {
                  logout();
                  navigate('/');
                }}
              >
                Log out
              </Button>
            </>
          ) : (
            <Button component={RouterLink} to="/login" color="inherit" variant="outlined">
              Admin login
            </Button>
          )}
        </Stack>
      </Toolbar>
    </AppBar>
  );
}
