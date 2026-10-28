import { ShieldCheck } from 'lucide-react';
import type { LegalDocument } from '../lib/legal';
import { LegalPage } from './LegalPage';

export const privacyDocument: LegalDocument = {
  slug: 'privacy',
  eyebrow: 'Trust',
  title: 'Privacy Policy',
  description:
    'What information Matjary collects, how it is used and protected, the cookies it sets, and the choices and rights you have.',
  lede: 'How we collect, use, share and protect your information when you visit Matjary or run a shop on it.',
  sections: [
    {
      id: 'scope',
      heading: 'Who we are and what this policy covers',
      blocks: [
        {
          kind: 'text',
          text: 'Matjary is a showcase and store-discovery platform for independent businesses. This policy explains how we handle personal data when you visit the website, sign in, browse shops, save posts, or publish a shop, posts and products.',
        },
        {
          kind: 'text',
          text: 'It does not cover how an individual shop handles your data. Shops are independent businesses and are responsible for their own practices, including any order you agree with them over WhatsApp or in person.',
        },
      ],
    },
    {
      id: 'information-we-collect',
      heading: 'Information we collect',
      blocks: [
        {
          kind: 'text',
          text: 'We collect information in three main ways: what you give us, what we receive when you sign in, and what is recorded automatically as you use the platform.',
        },
        {
          kind: 'list',
          items: [
            'Account information from Google Sign-In: your name, email address, profile picture and a stable Google account identifier. We never receive your Google password.',
            'Content you publish: shop names, descriptions, logos, branch addresses, phone and WhatsApp numbers you choose to show, posts, products, prices, photos and videos.',
            'Activity data: likes, views, saves and favorites, store visits, the posts and shops you interact with, and feedback you send us.',
            'Technical data: IP address, browser and device type, approximate region derived from your IP address, timestamps, requested pages and error logs produced by our servers and monitoring tools.',
            'Cart information: the products in your cart, the branch you selected, and quantities. Carts are linked to a server-generated anonymous cookie, and to your account when you are signed in.',
            'Location: if you ask to sort branches by distance, your browser may share your device location with the page. The distance calculation happens in your browser; Matjary does not store your device location.',
          ],
        },
        {
          kind: 'text',
          text: 'We do not ask for payment card details. Paid plans are arranged with our team, and any payment discussion happens outside the platform.',
        },
      ],
    },
    {
      id: 'how-we-use-it',
      heading: 'How we use your information',
      blocks: [
        {
          kind: 'list',
          items: [
            'to create and secure your account, verify your Google sign-in and keep your session valid;',
            'to publish and display your shop, posts, products and media, including generating the processed versions used on the platform;',
            'to operate features such as saved posts, favorites, carts, search, categories, stories and share links;',
            'to rank and order the feed, measure engagement, and understand which content is useful;',
            'to enforce plan limits and subscription rules, manage promotional credits, and keep accurate accounting records;',
            'to detect, prevent and respond to fraud, abuse, security incidents and technical problems;',
            'to provide support and respond to your questions;',
            'to comply with legal obligations and enforce our Terms & Conditions;',
            'to improve the platform and develop new features using aggregated or de-identified information.',
          ],
        },
        {
          kind: 'text',
          text: 'We rely on your consent where required, on the performance of our agreement with you, on our legitimate interests in operating and protecting the platform, and on legal obligations.',
        },
      ],
    },
    {
      id: 'cookies',
      heading: 'Cookies and local storage',
      blocks: [
        {
          kind: 'text',
          text: 'We use a small set of first-party cookies and browser storage. They are needed for sign-in, security and the cart to work; we do not use third-party advertising cookies.',
        },
        {
          kind: 'list',
          items: [
            'Session cookie (matjary_session): identifies your signed-in session. It is HttpOnly, and it lasts for the session lifetime, currently seven days, unless you sign out.',
            'Sign-in nonce cookie (matjary_nonce): proves that a Google sign-in started on this site. It is HttpOnly and expires after ten minutes.',
            'Visitor cookie (matjary_visitor): a random identifier that lets us count likes and views from visitors without an account and prevent duplicate counts. It lasts up to one year.',
            'Cart cookie (matjary_cart): identifies an anonymous cart so it can be restored on later visits. It is HttpOnly and server-generated.',
            'Saved posts (matjary:saved-posts): a list of post identifiers kept in your browser’s local storage so your saved posts survive a page reload. You can clear it by clearing site data.',
          ],
        },
        {
          kind: 'text',
          text: 'Google may set its own cookies while you use Google Sign-In; those are governed by Google’s privacy policy. You can block or delete cookies in your browser settings, but signing in, keeping a cart and saving posts may stop working.',
        },
      ],
    },
    {
      id: 'sharing',
      heading: 'When information is shared',
      blocks: [
        {
          kind: 'list',
          items: [
            'With visitors: what you publish — shop details, posts, products, images, videos and the contact details you choose to show — is public.',
            'With service providers: hosting, storage, monitoring, database and email providers that help us run the platform, under agreements that limit their use of the data.',
            'With Google: for sign-in and account verification.',
            'With WhatsApp, maps or other third parties: when you choose to contact a shop or open directions.',
            'For legal reasons: when we believe disclosure is required by law, a court order or a lawful request, or is necessary to protect rights, safety and the platform.',
            'In a business transfer: if the platform is sold or reorganized, information may be transferred as part of that transaction, subject to this policy.',
          ],
        },
        {
          kind: 'text',
          text: 'We do not sell your personal information and we do not share it for third-party advertising.',
        },
      ],
    },
    {
      id: 'retention',
      heading: 'How long we keep information',
      blocks: [
        {
          kind: 'text',
          text: 'We keep account and content data while your account exists and for a reasonable period after deletion, including for backups, dispute resolution and legal obligations. Session records expire with the session, sign-in nonces expire after ten minutes, and the visitor cookie lasts up to one year. Server logs and engagement records are kept for a limited period and are then deleted or aggregated.',
        },
        {
          kind: 'text',
          text: 'When you delete content, we stop serving it publicly, but copies that were already shared or cached elsewhere may remain outside our control. Backup copies are overwritten as part of the normal backup rotation.',
        },
      ],
    },
    {
      id: 'security',
      heading: 'How we protect information',
      blocks: [
        {
          kind: 'text',
          text: 'Sessions are protected with HttpOnly cookies, and the server stores only a hash of each session token and sign-in nonce. Private media is served with no-store caching and requires an authorised session, and access to production systems is restricted. We use HTTPS in production and monitor the platform for errors and abuse.',
        },
        {
          kind: 'text',
          text: 'No method of transmission or storage is completely secure. If you believe your account or data has been compromised, contact us using the details below so we can investigate.',
        },
      ],
    },
    {
      id: 'your-rights',
      heading: 'Your rights and choices',
      blocks: [
        {
          kind: 'text',
          text: 'Subject to applicable law, you may request access to the personal data we hold about you, ask us to correct or delete it, object to or restrict certain processing, withdraw consent where processing is based on consent, or ask for a copy of the data you provided.',
        },
        {
          kind: 'text',
          text: 'Signed-in owners can edit or delete most of their content from the dashboard. For account deletion or any other request, contact us using the details below; we may ask you to verify your identity through your signed-in account before acting. You also have the right to complain to the competent data protection authority where you live.',
        },
      ],
    },
    {
      id: 'children',
      heading: 'Children',
      blocks: [
        {
          kind: 'text',
          text: 'Matjary is intended for adults running or discovering businesses. The platform is not directed to children under 18, and we do not knowingly create accounts for children. If you believe a child has created an account or published personal data, contact us and we will delete it.',
        },
      ],
    },
    {
      id: 'international',
      heading: 'Where data is processed',
      blocks: [
        {
          kind: 'text',
          text: 'Matjary is operated from Lebanon, and the servers and service providers we use may be located in other countries. Information may therefore be processed outside the country where you live. Where required, we put safeguards in place for those transfers.',
        },
      ],
    },
    {
      id: 'changes',
      heading: 'Changes to this policy',
      blocks: [
        {
          kind: 'text',
          text: 'We may update this policy to reflect changes in the platform or the law. Material changes will be announced on the platform or by email before they take effect. The date at the top of this page shows when the current version was published.',
        },
      ],
    },
  ],
};

export function PrivacyPage() {
  return <LegalPage doc={privacyDocument} icon={ShieldCheck} />;
}
