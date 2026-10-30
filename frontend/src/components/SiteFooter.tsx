import { Mail, MessageCircle } from 'lucide-react';
import type { WebsiteSettings } from '../lib/website';
import { useUiLabel } from '../hooks/useUiLabel';
import { SUPPORT_EMAIL, SUPPORT_WHATSAPP_URL } from '../lib/contact';

export function SiteFooter({ settings }: { settings: WebsiteSettings }) {
  const uiText = useUiLabel();
  // An administrator may point visitors at a different inbox; until then the
  // platform support address is always available.
  const contactEmail = settings.contactEmail || SUPPORT_EMAIL;
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
        <a href={`mailto:${contactEmail}`}>
          <Mail size={14} />{' '}
          <span className="notranslate">{uiText('Get in touch')}</span>
        </a>
        <a
          href={SUPPORT_WHATSAPP_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          <MessageCircle size={14} />{' '}
          <span className="notranslate">{uiText('WhatsApp')}</span>
        </a>
      </div>
    </footer>
  );
}
