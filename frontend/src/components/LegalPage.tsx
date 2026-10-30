import './LegalPage.css';
import { usePageSeo } from '../hooks/usePageSeo';
import {
  ArrowLeft,
  ArrowRight,
  Mail,
  MessageCircle,
  Phone,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { useWebsiteSettings } from '../hooks/useWebsiteSettings';
import { SUPPORT_WHATSAPP_URL } from '../lib/contact';
import {
  brandDocument,
  LEGAL_CONTACT_EMAIL,
  LEGAL_CONTACT_PHONE,
  LEGAL_LAST_UPDATED,
  telHref,
  type LegalBlock,
  type LegalDocument,
} from '../lib/legal';
import { SiteFooter } from './SiteFooter';
import { SiteHeader } from './SiteHeader';

function Block({ block }: { block: LegalBlock }) {
  if (block.kind === 'list')
    return (
      <ul>
        {block.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    );
  return <p>{block.text}</p>;
}

function ContactCard({
  email,
  phone,
}: {
  email: string | null;
  phone: string | null;
}) {
  return (
    <section
      id="contact"
      className="legal-contact"
      aria-labelledby="legal-contact-title"
    >
      <div className="legal-contact-head">
        <h2 id="legal-contact-title">Questions about this page?</h2>
        <p>
          Write to us or message us on WhatsApp and we will get back to you. We
          usually reply within a few business days.
        </p>
      </div>
      <ul className="legal-contact-list">
        <li>
          <span className="legal-contact-icon" aria-hidden="true">
            <Mail size={17} />
          </span>
          <span className="legal-contact-body">
            <span className="legal-contact-label">Email</span>
            {email ? (
              <a href={`mailto:${email}`}>{email}</a>
            ) : (
              <span className="legal-contact-pending">
                The contact email will be published here soon.
              </span>
            )}
          </span>
        </li>
        <li>
          <span className="legal-contact-icon" aria-hidden="true">
            <Phone size={17} />
          </span>
          <span className="legal-contact-body">
            <span className="legal-contact-label">Phone</span>
            {phone ? (
              <a href={telHref(phone)}>{phone}</a>
            ) : (
              <span className="legal-contact-pending">
                The phone number will be published here soon.
              </span>
            )}
          </span>
        </li>
        <li>
          <span className="legal-contact-icon" aria-hidden="true">
            <MessageCircle size={17} />
          </span>
          <span className="legal-contact-body">
            <span className="legal-contact-label">WhatsApp</span>
            <a
              href={SUPPORT_WHATSAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              Message us on WhatsApp
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </span>
        </li>
      </ul>
    </section>
  );
}

export function LegalPage({
  doc: source,
  icon: Icon,
}: {
  doc: LegalDocument;
  icon: LucideIcon;
}) {
  const { settings, theme } = useWebsiteSettings(false);
  // The written copy keeps the original brand; display the live name instead.
  const doc = brandDocument(source, settings.siteName);
  const email = LEGAL_CONTACT_EMAIL || settings.contactEmail;
  const phone = LEGAL_CONTACT_PHONE;

  usePageSeo({
    title: `${doc.title} — ${settings.siteName}`,
    description: doc.description,
    siteName: settings.siteName,
  });

  return (
    <div className="app legal-page" style={theme}>
      <a className="skip-link" href="#legal-main">
        Skip to content
      </a>
      <SiteHeader settings={settings} view="legal" />
      <div className="page-shell">
        <main className="legal-main" id="legal-main" tabIndex={-1}>
          <a className="legal-back" href="/">
            <ArrowLeft size={15} aria-hidden="true" /> Back to discoveries
          </a>
          <header className="legal-hero">
            <span className="legal-eyebrow">
              <Icon size={14} aria-hidden="true" /> {doc.eyebrow}
            </span>
            <h1>{doc.title}</h1>
            <p className="legal-lede">{doc.lede}</p>
            <span className="legal-updated">
              Last updated · {LEGAL_LAST_UPDATED}
            </span>
          </header>

          <div className="legal-layout">
            <aside className="legal-aside">
              <nav className="legal-toc" aria-label="On this page">
                <h2>On this page</h2>
                <ol>
                  {doc.sections.map((section) => (
                    <li key={section.id}>
                      <a href={`#${section.id}`}>{section.heading}</a>
                    </li>
                  ))}
                  <li>
                    <a href="#contact">Contact us</a>
                  </li>
                </ol>
              </nav>
              <div className="legal-aside-card">
                <ShieldCheck size={18} aria-hidden="true" />
                <p>
                  You can also read our{' '}
                  {doc.slug === 'terms' ? (
                    <a href="/privacy">Privacy Policy</a>
                  ) : (
                    <a href="/terms">Terms &amp; Conditions</a>
                  )}
                  . Both pages apply whenever you use {settings.siteName}.
                </p>
              </div>
            </aside>

            <article className="legal-document" aria-label={doc.title}>
              {doc.sections.map((section, index) => (
                <section
                  key={section.id}
                  id={section.id}
                  className="legal-section"
                  aria-labelledby={`${section.id}-heading`}
                >
                  <span className="legal-section-number" aria-hidden="true">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <h2 id={`${section.id}-heading`}>{section.heading}</h2>
                  {section.blocks.map((block, blockIndex) => (
                    <Block key={`${section.id}-${blockIndex}`} block={block} />
                  ))}
                </section>
              ))}
              <ContactCard email={email} phone={phone} />
            </article>
          </div>

          <aside className="legal-next">
            <p>
              {doc.slug === 'terms'
                ? 'Want to know how we handle personal data?'
                : 'Looking for the rules for shops and posts?'}
            </p>
            <a
              className="secondary-button"
              href={doc.slug === 'terms' ? '/privacy' : '/terms'}
            >
              {doc.slug === 'terms'
                ? 'Read the Privacy Policy'
                : 'Read the Terms'}
              <ArrowRight size={16} aria-hidden="true" />
            </a>
          </aside>

          <SiteFooter settings={settings} />
        </main>
      </div>
    </div>
  );
}
