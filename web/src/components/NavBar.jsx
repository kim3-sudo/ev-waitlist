import { useLayoutEffect, useRef, useState } from 'react';
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
import DirectionsCarIcon from '@mui/icons-material/DirectionsCar';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useSettings } from '../context/SettingsContext.jsx';
import { sitePath } from '../sitePaths.js';

// The account links. An admin gets their profile, and their vehicles when they can use the driver
// features. A driver-only account gets its account page.
function AccountMenuItems({ hasAdminAccess, canDrive, onPick }) {
  return [
    hasAdminAccess && (
      <MenuItem key="profile" component={RouterLink} to="/account" onClick={onPick}>
        <ListItemIcon>
          <PersonIcon fontSize="small" />
        </ListItemIcon>
        My profile
      </MenuItem>
    ),
    canDrive && (
      <MenuItem key="driver" component={RouterLink} to={sitePath('/driver')} onClick={onPick}>
        <ListItemIcon>
          <DirectionsCarIcon fontSize="small" />
        </ListItemIcon>
        {hasAdminAccess ? 'My vehicles' : 'My account'}
      </MenuItem>
    ),
  ];
}

function ProfileMenu({ email, onLogout, hasAdminAccess, canDrive }) {
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
        <AccountMenuItems hasAdminAccess={hasAdminAccess} canDrive={canDrive} onPick={close} />
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
function CollapsedNavMenu({ email, isAuthenticated, hasAdminAccess, canDrive, onLogout }) {
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
          Find a charger
        </MenuItem>
        {isAuthenticated && hasAdminAccess && [
          <MenuItem key="reports" component={RouterLink} to="/reports" onClick={close}>
            Reports
          </MenuItem>,
          <MenuItem key="help" component={RouterLink} to="/help" onClick={close}>
            Help
          </MenuItem>,
          <MenuItem key="admin" component={RouterLink} to="/admin" onClick={close}>
            Admin
          </MenuItem>,
        ]}
        {isAuthenticated ? (
          [
            <Divider key="divider" />,
            <MenuItem key="email" disabled sx={{ opacity: '1 !important', fontSize: 13 }}>
              {email}
            </MenuItem>,
            <AccountMenuItems key="account" hasAdminAccess={hasAdminAccess} canDrive={canDrive} onPick={close} />,
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
          [
            <MenuItem key="sign-in" component={RouterLink} to={sitePath('/sign-in')} onClick={close}>
              Sign in
            </MenuItem>,
            <MenuItem key="admin-login" component={RouterLink} to="/login" onClick={close}>
              Admin login
            </MenuItem>,
          ]
        )}
      </Menu>
    </>
  );
}

export function NavBar() {
  const { isAuthenticated, email, logout, hasAdminAccess, can } = useAuth();
  // Anyone with a driver account can keep their vehicles and details.
  const canDrive = can('driver.account');
  const { settings } = useSettings();
  const navigate = useNavigate();
  const collapsed = useMediaQuery((theme) => theme.breakpoints.down('md'));
  const barRef = useRef(null);

  // The navbar's real height depends on the screen (48px on a landscape phone, 56px on a
  // narrow portrait screen, 64px otherwise). Publish it so the sidebars can size and pin
  // themselves against it instead of assuming 64px.
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return undefined;
    const apply = () => {
      document.documentElement.style.setProperty('--navbar-height', `${bar.offsetHeight}px`);
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  return (
    <AppBar ref={barRef} position="sticky" color="primary" elevation={0}>
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
          <CollapsedNavMenu
            email={email}
            isAuthenticated={isAuthenticated}
            hasAdminAccess={hasAdminAccess}
            canDrive={canDrive}
            onLogout={handleLogout}
          />
        ) : (
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexShrink: 0 }}>
            <Button component={RouterLink} to="/" color="inherit">
              Find a charger
            </Button>
            {isAuthenticated && hasAdminAccess && (
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
              </>
            )}
            {isAuthenticated ? (
              <ProfileMenu email={email} onLogout={handleLogout} hasAdminAccess={hasAdminAccess} canDrive={canDrive} />
            ) : (
              <>
                <Button component={RouterLink} to={sitePath('/sign-in')} color="inherit">
                  Sign in
                </Button>
                <Button component={RouterLink} to="/login" color="inherit" variant="outlined">
                  Admin login
                </Button>
              </>
            )}
          </Stack>
        )}
      </Toolbar>
    </AppBar>
  );
}
