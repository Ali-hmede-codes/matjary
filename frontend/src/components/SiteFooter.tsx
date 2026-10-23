import { Mail, Sparkles } from 'lucide-react';
import type { WebsiteSettings } from '../lib/website';

export function SiteFooter({
  settings,
  demo = false,
  onToggleDemo,
}: {
  settings: WebsiteSettings;
  demo?: boolean;
  onToggleDemo?: () => void;
}) {
  return (
    <footer className="site-footer">
      <p>
        {settings.footerText ||
          `© ${new Date().getFullYear()} ${settings.siteName}. Made for discovery.`}
      </p>
      <div className="footer-links">
        <a href="/pricing">Plans & pricing</a>
        {onToggleDemo && (
          <button className="text-button" onClick={onToggleDemo}>
            <Sparkles size={15} />
            {demo ? 'Back to live feed' : 'Preview the design'}
          </button>
        )}
        {settings.contactEmail && (
          <a href={`mailto:${settings.contactEmail}`}>
            <Mail size={14} /> Get in touch
          </a>
        )}
      </div>
    </footer>
  );
}
