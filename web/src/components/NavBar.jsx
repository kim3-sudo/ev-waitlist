import { useState } from 'react';
import {
  AppBar,
  Toolbar,
  Typography,
  Button,
  Stack,
  Avatar,
  Menu,
  MenuItem,
  Divider,
  ListItemIcon,
  IconButton,
  useMediaQuery,
} from '@mui/material';
import EvStationIcon from '@mui/icons-material/EvStation';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import MenuIcon from '@mui/icons-material/Menu';
import PersonIcon from '@mui/icons-material/Person';
import LogoutIcon from '@mui/icons-material/Logout';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useSettings } from '../context/SettingsContext.jsx';

function ProfileMenu({ email, onLogout }) {
  const [anchorEl, setAnchorEl] = useState(null);
  const close = () => setAnchorEl(null);

  return (
    <>
      <Button
        color="inherit"
        onClick={(e) => setAnchorEl(e.currentTarget)}
        aria-controls={anchorEl ? 'profile-menu' : undefined}
        aria-haspopup="true"
        aria-expanded={anchorEl ? 'true' : undefined}
        endIcon={<ArrowDropDownIcon />}
      >
        Profile
      </Button>
      <Menu
        id="profile-menu"
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MenuItem disabled sx={{ opacity: '1 !important', fontSize: 13 }}>
          {email}
        </MenuItem>
        <Divider />
        <MenuItem component={RouterLink} to="/account" onClick={close}>
          <ListItemIcon>
            <PersonIcon fontSize="small" />
          </ListItemIcon>
          My profile
        </MenuItem>
        <MenuItem
          onClick={() => {
            close();
            onLogout();
          }}
        >
          <ListItemIcon>
            <LogoutIcon fontSize="small" />
          </ListItemIcon>
          Log out
        </MenuItem>
      </Menu>
    </>
  );
}

// On narrow screens the links collapse into one menu behind a menu button.
function CollapsedNavMenu({ email, isAuthenticated, onLogout }) {
  const [anchorEl, setAnchorEl] = useState(null);
  const close = () => setAnchorEl(null);

  return (
    <>
      <IconButton
        color="inherit"
        edge="end"
        aria-label="Open navigation menu"
        aria-controls={anchorEl ? 'nav-menu' : undefined}
        aria-haspopup="true"
        aria-expanded={anchorEl ? 'true' : undefined}
        onClick={(e) => setAnchorEl(e.currentTarget)}
      >
        <MenuIcon />
      </IconButton>
      <Menu
        id="nav-menu"
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { minWidth: 220 } } }}
      >
        <MenuItem component={RouterLink} to="/" onClick={close}>
          Waitlist
        </MenuItem>
        {isAuthenticated ? (
          [
            <MenuItem key="reports" component={RouterLink} to="/reports" onClick={close}>
              Reports
            </MenuItem>,
            <MenuItem key="help" component={RouterLink} to="/help" onClick={close}>
              Help
            </MenuItem>,
            <MenuItem key="admin" component={RouterLink} to="/admin" onClick={close}>
              Admin
            </MenuItem>,
            <Divider key="divider" />,
            <MenuItem key="email" disabled sx={{ opacity: '1 !important', fontSize: 13 }}>
              {email}
            </MenuItem>,
            <MenuItem key="profile" component={RouterLink} to="/account" onClick={close}>
              <ListItemIcon>
                <PersonIcon fontSize="small" />
              </ListItemIcon>
              My profile
            </MenuItem>,
            <MenuItem
              key="logout"
              onClick={() => {
                close();
                onLogout();
              }}
            >
              <ListItemIcon>
                <LogoutIcon fontSize="small" />
              </ListItemIcon>
              Log out
            </MenuItem>,
          ]
        ) : (
          <MenuItem component={RouterLink} to="/login" onClick={close}>
            Admin login
          </MenuItem>
        )}
      </Menu>
    </>
  );
}

export function NavBar() {
  const { isAuthenticated, email, logout } = useAuth();
  const { settings } = useSettings();
  const navigate = useNavigate();
  const collapsed = useMediaQuery((theme) => theme.breakpoints.down('md'));

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  return (
    <AppBar position="static" color="primary" elevation={0}>
      <Toolbar sx={{ gap: 1 }}>
        {settings.logoUrl ? (
          <Avatar src={settings.logoUrl} variant="rounded" sx={{ mr: 1, width: 32, height: 32, flexShrink: 0 }} />
        ) : (
          <EvStationIcon sx={{ mr: 1, flexShrink: 0 }} />
        )}
        <Typography
          variant="h6"
          noWrap
          component={RouterLink}
          to="/"
          sx={{ flexGrow: 1, minWidth: 0, color: 'inherit', textDecoration: 'none', fontWeight: 600 }}
        >
          {settings.companyName}
        </Typography>
        {collapsed ? (
          <CollapsedNavMenu email={email} isAuthenticated={isAuthenticated} onLogout={handleLogout} />
        ) : (
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexShrink: 0 }}>
            <Button component={RouterLink} to="/" color="inherit">
              Waitlist
            </Button>
            {isAuthenticated ? (
              <>
                <Button component={RouterLink} to="/reports" color="inherit">
                  Reports
                </Button>
                <Button component={RouterLink} to="/help" color="inherit">
                  Help
                </Button>
                <Button component={RouterLink} to="/admin" color="inherit">
                  Admin
                </Button>
                <ProfileMenu email={email} onLogout={handleLogout} />
              </>
            ) : (
              <Button component={RouterLink} to="/login" color="inherit" variant="outlined">
                Admin login
              </Button>
            )}
          </Stack>
        )}
      </Toolbar>
    </AppBar>
  );
}
