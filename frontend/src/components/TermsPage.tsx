import { Scale } from 'lucide-react';
import type { LegalDocument } from '../lib/legal';
import { LegalPage } from './LegalPage';

export const termsDocument: LegalDocument = {
  slug: 'terms',
  eyebrow: 'Legal',
  title: 'Terms & Conditions',
  description:
    'The rules for using Matjary: accounts, published content, shops and orders, subscriptions, acceptable use, and liability.',
  lede: 'The rules that apply when you create an account, publish a shop, share posts, or simply browse the platform.',
  sections: [
    {
      id: 'acceptance',
      heading: 'Acceptance of these terms',
      blocks: [
        {
          kind: 'text',
          text: 'Matjary is a showcase and store-discovery platform. It lets independent businesses publish photos, short videos, product details and shop information, and lets visitors discover, save and share them.',
        },
        {
          kind: 'text',
          text: 'These Terms & Conditions (“Terms”) govern your use of the platform, including the website, the mobile experience and the application programming interface. By signing in, publishing content or otherwise using Matjary, you confirm that you have read and agree to these Terms and to our Privacy Policy. If you do not agree, please do not use the platform.',
        },
        {
          kind: 'text',
          text: 'If you use Matjary on behalf of a business, you confirm that you are authorised to accept these Terms for that business, and “you” refers to both you and the business.',
        },
      ],
    },
    {
      id: 'accounts',
      heading: 'Accounts and eligibility',
      blocks: [
        {
          kind: 'text',
          text: 'Accounts are created by signing in with Google. We receive basic profile information such as your name, email address and profile picture, but never your Google password. Keep your Google account secure and your email address current, because we use it for account notices.',
        },
        {
          kind: 'text',
          text: 'You must be at least 18 years old, or the age of majority where you live, to create an account or a shop. You are responsible for all activity carried out through your account and for keeping your sign-in credentials private.',
        },
        {
          kind: 'text',
          text: 'We may suspend, restrict or close accounts that breach these Terms, that present a risk to other users or the platform, or where required by law. You may stop using the platform at any time and ask us to delete your account.',
        },
      ],
    },
    {
      id: 'content-and-licence',
      heading: 'Your content and the licence you give us',
      blocks: [
        {
          kind: 'text',
          text: 'You keep ownership of the photos, videos, product details, shop information and other content you publish. These Terms do not transfer your ownership to Matjary.',
        },
        {
          kind: 'text',
          text: 'To operate the platform, you grant Matjary a worldwide, non-exclusive, royalty-free licence to host, store, reproduce, resize, transcode, create previews of, display, distribute and promote the content you publish. This covers things like generating smaller image formats, encoding video previews, building share previews, and showing your content in the feed, search, category pages and shop pages. The licence lasts while your content is hosted and for a short backup period after deletion.',
        },
        {
          kind: 'text',
          text: 'You confirm that you own or have the necessary rights and permissions for everything you upload, including permission from people who appear in your photos or videos, and that your content does not infringe anyone’s intellectual property, privacy or other rights.',
        },
        {
          kind: 'text',
          text: 'Drafts stay private. Published content can be viewed and shared publicly by anyone. Unpublishing stops new public requests for the content, but copies that were already shared, downloaded or cached elsewhere may continue to exist outside our control.',
        },
      ],
    },
    {
      id: 'shops-and-orders',
      heading: 'Shops, products and orders',
      blocks: [
        {
          kind: 'text',
          text: 'Each shop is run by an independent business, not by Matjary. Shop owners are solely responsible for the products and services they offer, including their descriptions, prices, availability, quality, legality, delivery, returns, warranties and customer service.',
        },
        {
          kind: 'text',
          text: 'Some shops let visitors put products in a cart and prepare an order message that is sent to the shop over WhatsApp. Matjary does not process payments, does not take a commission on those sales and is not a party to the transaction between you and the shop. Price, availability, payment and delivery are agreed directly with the shop.',
        },
        {
          kind: 'text',
          text: 'Any dispute about a purchase must be resolved with the shop. We may help by removing content that clearly breaches these Terms, but we cannot guarantee refunds or resolve commercial disputes.',
        },
      ],
    },
    {
      id: 'acceptable-use',
      heading: 'Acceptable use',
      blocks: [
        {
          kind: 'text',
          text: 'Use the platform lawfully and respectfully. In particular, you must not:',
        },
        {
          kind: 'list',
          items: [
            'publish content that is illegal, hateful, harassing, defamatory, sexually exploitative, threatening or otherwise harmful, or that promotes violence or self-harm;',
            'infringe intellectual property, privacy or other rights, or impersonate a person or business;',
            'publish false, misleading or deceptive information, including fake prices, fake reviews or misleading product claims;',
            'sell or promote items that are prohibited by applicable law, including counterfeit goods, stolen goods, weapons, drugs, tobacco or nicotine products where restricted, and wildlife products;',
            'upload malware, attempt to gain unauthorised access to accounts or systems, probe or scan the platform, or bypass rate limits and other security measures;',
            'scrape, copy or systematically extract content or data from the platform without our written permission;',
            'send spam, unsolicited advertising, or use the platform to harvest contact details;',
            'overload the platform, interfere with its normal operation, or use it in a way that could disable or impair it.',
          ],
        },
        {
          kind: 'text',
          text: 'We may remove content, revoke verification badges, or restrict features where we believe these rules have been broken. Serious or repeated breaches may lead to account suspension or closure.',
        },
      ],
    },
    {
      id: 'plans-and-limits',
      heading: 'Plans, trials and limits',
      blocks: [
        {
          kind: 'text',
          text: 'New accounts start with a free trial, currently seven days, that begins on first sign-in. During the trial you can publish within the plan limits shown on the plans page. When the trial or a paid subscription ends, your published shops, posts and products stay online, but owner actions that create or change content are blocked until an active plan is in place.',
        },
        {
          kind: 'text',
          text: 'Paid plans are arranged with our team and assigned by an administrator; there is no online checkout. Prices, billing cycles and the features and quotas of each plan are described on the plans page. Fees, renewal dates and refund arrangements are confirmed with you before a paid plan is assigned, and we may change plans and prices for future periods.',
        },
        {
          kind: 'text',
          text: 'Plan limits such as the number of posts, products and other allowances apply to your account. Media storage itself is unlimited on every plan, but upload ceilings and supported file types and durations still apply. Limits may be updated as the platform evolves.',
        },
        {
          kind: 'text',
          text: 'Promotional features such as boosts may use prepaid credits. Credits are promotional, have no cash value, are not transferable, and are not redeemable for cash. Spending and ledger records are kept for accounting and dispute purposes.',
        },
      ],
    },
    {
      id: 'media-processing',
      heading: 'Uploads and media processing',
      blocks: [
        {
          kind: 'text',
          text: 'Uploaded media is validated and processed before it appears publicly. We generate resized and compressed image versions and MP4 previews with poster images, and we may remove the original file after those versions are ready. Do not upload your only copy of a photo or video: keep your own backup of everything you publish.',
        },
        {
          kind: 'text',
          text: 'Processing can fail because of corrupted files, unsupported formats, or size and duration limits. We do not guarantee that every upload will be accepted, or that generated versions will match the original exactly in colour, sharpness or playback behaviour.',
        },
      ],
    },
    {
      id: 'platform-changes',
      heading: 'Platform availability and changes',
      blocks: [
        {
          kind: 'text',
          text: 'We aim to keep Matjary available and reliable, but the platform is provided on an “as is” and “as available” basis. We may change, pause or discontinue features, run maintenance, and set technical limits. We do not guarantee uninterrupted or error-free operation.',
        },
        {
          kind: 'text',
          text: 'We may remove or restrict access to content that breaches these Terms or the law. Where reasonably possible, we will explain the reason, but we are not obliged to host any particular content.',
        },
      ],
    },
    {
      id: 'third-party-services',
      heading: 'Third-party services',
      blocks: [
        {
          kind: 'text',
          text: 'The platform relies on third-party services, including Google Sign-In, WhatsApp links, map and directions links, and hosting and infrastructure providers. Their own terms and privacy policies apply to your use of those services. We are not responsible for the content, availability or practices of third-party sites.',
        },
      ],
    },
    {
      id: 'liability',
      heading: 'Disclaimers and limitation of liability',
      blocks: [
        {
          kind: 'text',
          text: 'To the maximum extent permitted by applicable law, Matjary is not liable for indirect, incidental, special, consequential or punitive damages, or for loss of profit, revenue, data or goodwill, arising from your use of the platform or from content published by others.',
        },
        {
          kind: 'text',
          text: 'We do not guarantee the accuracy, completeness or lawfulness of content published by shops or visitors. You are responsible for making your own checks before relying on any listing or entering into a transaction with a shop.',
        },
        {
          kind: 'text',
          text: 'Nothing in these Terms limits rights that cannot be limited by law, including mandatory consumer rights, or liability for fraud, wilful misconduct or death or personal injury caused by negligence.',
        },
      ],
    },
    {
      id: 'termination',
      heading: 'Termination',
      blocks: [
        {
          kind: 'text',
          text: 'You may stop using Matjary at any time and ask us to delete your account and content. Some content may remain visible while a deletion request is processed, and backup copies may persist for a limited period.',
        },
        {
          kind: 'text',
          text: 'We may suspend or terminate your access if you breach these Terms, if required by law, or to protect users, the platform or third parties. Sections that by their nature should survive termination, such as content licences for copies already shared, disclaimers, and governing law, will continue to apply.',
        },
      ],
    },
    {
      id: 'changes',
      heading: 'Changes to these terms',
      blocks: [
        {
          kind: 'text',
          text: 'We may update these Terms from time to time. Material changes will be announced on the platform or by email before they take effect. If you continue to use Matjary after the updated Terms take effect, you accept the updated Terms. The date at the top of this page shows when the current version was published.',
        },
      ],
    },
    {
      id: 'governing-law',
      heading: 'Governing law',
      blocks: [
        {
          kind: 'text',
          text: 'These Terms are governed by the laws of Lebanon. Before starting formal proceedings, please contact us so we can try to resolve the issue informally. If a dispute cannot be resolved, the competent courts of Beirut have jurisdiction, without prejudice to mandatory consumer protections that apply where you live.',
        },
      ],
    },
  ],
};

export function TermsPage() {
  return <LegalPage doc={termsDocument} icon={Scale} />;
}
