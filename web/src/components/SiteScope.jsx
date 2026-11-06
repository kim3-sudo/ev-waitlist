import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { setPublicSite } from '../api/client.js';
import { useSettings } from '../context/SettingsContext.jsx';

// Shows a site's public pages under /t/<slug>. Its API calls go to that site,
// and its branding is loaded from it. Leaving the page returns to the default site.
export function SiteScope({ children }) {
  const { slug } = useParams();
  const { refresh } = useSettings();

  // Set during render so the page's first requests already go to this site.
  setPublicSite(slug);

  useEffect(() => {
    refresh();
    return () => {
      setPublicSite(null);
      refresh();
    };
  }, [slug, refresh]);

  return children;
}
