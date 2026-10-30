import { Mail } from 'lucide-react';
import type { WebsiteSettings } from '../lib/website';
import { useUiLabel } from '../hooks/useUiLabel';

export function SiteFooter({ settings }: { settings: WebsiteSettings }) {
  const uiText = useUiLabel();
  return (
    <footer className="site-footer">
      <p>
        {settings.footerText || (
          <>
            {`© ${new Date().getFullYear()} `}
            <span className="notranslate">{settings.siteName}</span>
            {'. Made for discovery.'}
          </>
        )}
      </p>
      <div className="footer-links">
        <a href="/pricing">
          <span className="notranslate">{uiText('Plans & pricing')}</span>
        </a>
        <a href="/terms">
          <span className="notranslate">{uiText('Terms & Conditions')}</span>
        </a>
        <a href="/privacy">
          <span className="notranslate">{uiText('Privacy Policy')}</span>
        </a>
        {settings.contactEmail && (
          <a href={`mailto:${settings.contactEmail}`}>
            <Mail size={14} />{' '}
            <span className="notranslate">{uiText('Get in touch')}</span>
          </a>
        )}
      </div>
    </footer>
  );
}
