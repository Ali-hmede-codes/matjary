type FieldType =
  | 'text'
  | 'color'
  | 'textarea'
  | 'number'
  | 'boolean'
  | 'json'
  | 'date'
  | 'select'
  | 'password';
interface Field {
  name: string;
  type: FieldType;
  required?: boolean;
  options?: string[];
  nullable?: boolean;
}
const f = (
  name: string,
  type: FieldType = 'text',
  required = false,
  options?: string[],
  nullable = false,
): Field => ({ name, type, required, options, nullable });
const text = (name: string) => f(name, 'text', false, undefined, true);
const json = (name: string, required = false) =>
  f(name, 'json', required, undefined, !required);
const product = [
  f('name', 'text', true),
  text('description'),
  f('priceCents', 'number', true),
  f('currency'),
  f('category', 'select', false, [
    'food',
    'beverage',
    'merchandise',
    'service',
    'other',
  ]),
  f('status', 'select', false, ['draft', 'active', 'out_of_stock', 'archived']),
  text('sku'),
  f('stockQuantity', 'number', false, undefined, true),
  f('weightGrams', 'number', false, undefined, true),
  json('imageKeys'),
  json('tags'),
  f('sortOrder', 'number'),
  f('requiresShipping', 'boolean'),
];
const post = [
  f('title', 'text', true),
  text('description'),
  f('status', 'select', false, ['draft', 'published', 'archived']),
];
const store = [
  f('name', 'text', true),
  text('description'),
  text('brandColor'),
  f('storeType', 'select', false, ['ecommerce', 'restaurant_menu']),
  json('socialMediaLinks'),
  json('location'),
];
const plan = [
  f('name', 'text', true),
  f('slug', 'text', true),
  text('description'),
  f('priceCents', 'number'),
  f('currency'),
  f('billingCycle', 'select', false, ['monthly', 'yearly', 'lifetime']),
  json('limits', true),
  f('isActive', 'boolean'),
  f('sortOrder', 'number'),
  f('legacyTier', 'select', false, ['free', 'basic', 'premium'], true),
];
const campaign = [
  f('name', 'text', true),
  f('budgetCoins', 'text', true),
  f('dailyBudgetCoins'),
  f('bidStrategy', 'select', false, ['auto', 'cpc', 'cpm']),
  f('bidAmountCoins'),
  json('targeting', true),
  json('creative'),
  f('startAt', 'date'),
  f('endAt', 'date'),
];
const redirect = [
  f('fromPath', 'text', true),
  f('toPath', 'text', true),
  f('storeId'),
  f('statusCode', 'number'),
  f('isActive', 'boolean'),
];
const metadata = [
  text('metaTitle'),
  text('metaDescription'),
  text('metaKeywords'),
  text('ogTitle'),
  text('ogDescription'),
  text('ogImageKey'),
  f('ogType', 'select', false, ['website', 'product', 'article']),
  f('twitterCard', 'select', false, ['summary', 'summary_large_image']),
  f('robots', 'select', false, [
    'index, follow',
    'index, nofollow',
    'noindex, follow',
    'noindex, nofollow',
  ]),
  f('aiRobots', 'select', false, ['allow', 'disallow'], true),
  f(
    'aiTraining',
    'select',
    false,
    ['training-allow', 'training-disallow'],
    true,
  ),
  text('canonicalUrl'),
];

interface View {
  label: string;
  description: string;
  columns?: string[];
  create?: Field[];
  edit?: Field[];
  defaults?: Record<string, unknown>;
  endpoint?: string;
  settings?: boolean;
}
export const ADMIN_VIEWS: Record<string, View> = {
  users: {
    label: 'Users',
    description: 'Google accounts, access, and session controls.',
    columns: ['displayName', 'email', 'suspendedAt', 'createdAt'],
    edit: [f('displayName', 'text', true)],
  },
  stores: {
    label: 'Stores',
    description: 'Manage storefronts, branding, location, and verification.',
    columns: ['name', 'slug', 'ownerId', 'adminArchivedAt'],
    create: [f('ownerId', 'text', true), f('slug', 'text', true), ...store],
    edit: [
      ...store,
      text('logoKey'),
      text('bannerKey'),
      json('designSettings'),
      f('enableCart', 'boolean'),
      f('enableWhatsAppCheckout', 'boolean'),
    ],
    defaults: { storeType: 'ecommerce' },
  },
  products: {
    label: 'Products',
    description: 'Catalog, pricing in cents, and stock availability.',
    columns: ['name', 'priceCents', 'currency', 'status', 'adminArchivedAt'],
    create: [f('storeId', 'text', true), f('slug', 'text', true), ...product],
    edit: product,
    defaults: {
      status: 'draft',
      currency: 'USD',
      priceCents: 0,
      requiresShipping: true,
    },
  },
  posts: {
    label: 'Posts',
    description: 'Create showcases, publish stories, and manage their media.',
    columns: ['title', 'slug', 'status', 'mediaCount', 'adminArchivedAt'],
    create: [
      f('ownerId', 'text', true),
      f('storeId'),
      f('slug', 'text', true),
      ...post,
    ],
    edit: [...post, f('publishedAt', 'date', false, undefined, true)],
    defaults: { status: 'draft' },
  },
  media: {
    label: 'Media library',
    description:
      'Inspect processing, securely preview media, and retry eligible failures. Upload from a post.',
    columns: ['kind', 'status', 'sizeBytes', 'altText', 'adminArchivedAt'],
    edit: [text('altText'), f('position', 'number')],
  },
  plans: {
    label: 'Subscription plans',
    description:
      'Plan limits and features. The free fallback remains available.',
    columns: ['name', 'slug', 'priceCents', 'billingCycle', 'isActive'],
    create: plan,
    edit: plan,
    defaults: {
      currency: 'USD',
      billingCycle: 'monthly',
      limits: {},
      isActive: true,
      priceCents: 0,
    },
  },
  subscriptions: {
    label: 'Subscriptions',
    description: 'Assign a plan, inspect history, or cancel an assignment.',
    columns: ['userId', 'planId', 'status', 'expiresAt'],
    create: [
      f('userId', 'text', true),
      f('planId', 'text', true),
      f('expiresAt', 'date'),
      text('notes'),
    ],
    endpoint: 'subscriptions/assign',
  },
  campaigns: {
    label: 'Boost campaigns',
    description:
      'Review campaigns and manage reserved budgets without rewriting spending.',
    columns: ['name', 'status', 'budgetCoins', 'spentCoins', 'userId'],
    create: [
      f('ownerId', 'text', true),
      f('targetType', 'select', true, ['store', 'showcase']),
      f('targetId', 'text', true),
      ...campaign,
    ],
    edit: campaign,
    defaults: { targetType: 'store', bidStrategy: 'auto', targeting: {} },
  },
  wallets: {
    label: 'Wallets',
    description:
      'Integer-safe adjustments with a reason and a unique operation receipt.',
    columns: ['userId', 'balance', 'updatedAt'],
  },
  transactions: {
    label: 'Transactions',
    description:
      'Read-only financial history. Existing receipts cannot be edited or deleted.',
    columns: [
      'type',
      'amount',
      'balanceBefore',
      'balanceAfter',
      'userId',
      'createdAt',
    ],
  },
  carts: {
    label: 'Carts',
    description:
      'Inspect cart history or expire an active cart. Checkout history is preserved.',
    columns: ['id', 'userId', 'storeId', 'status', 'createdAt'],
  },
  redirects: {
    label: 'Redirects',
    description:
      'Manage validated site paths and deactivate obsolete redirects.',
    columns: ['fromPath', 'toPath', 'statusCode', 'isActive'],
    create: redirect,
    edit: redirect,
    defaults: { statusCode: 301, isActive: true },
  },
  errors: {
    label: 'Error inbox',
    description:
      'Sanitized issues grouped by operation. New failures reopen resolved issues.',
    columns: [
      'service',
      'operation',
      'code',
      'occurrences',
      'state',
      'lastSeenAt',
    ],
  },
  audit: {
    label: 'Audit history',
    description:
      'Append-only administrative actions, reasons, and request IDs.',
    columns: ['action', 'resource', 'resourceId', 'actorId', 'createdAt'],
  },
  'website-settings': {
    label: 'Website settings',
    description:
      'Public website branding. Images use public HTTPS URLs or root-relative paths; private media stays private. SEO settings are managed separately.',
    settings: true,
    endpoint: 'website-settings',
    edit: [
      f('siteName', 'text', true),
      text('tagline'),
      text('description'),
      ...['primaryColor', 'secondaryColor', 'backgroundColor', 'textColor'].map(
        (key) => f(key, 'color', true),
      ),
      ...[
        'logoUrl',
        'faviconUrl',
        'bannerUrl',
        'contactEmail',
        'footerText',
      ].map(text),
    ],
  },
  'boost-settings': {
    label: 'Boost settings',
    description: 'Pricing, campaign review policy, and budget limits.',
    settings: true,
    endpoint: 'boost/settings',
    edit: [
      'coinPriceCents',
      'minPurchaseCoins',
      'maxPurchaseCoins',
      'defaultDailyBudgetCoins',
      'minCampaignBudgetCoins',
      'maxCampaignDurationDays',
      'autoApproveThresholdCoins',
      'cpcMinBidCoins',
      'cpmMinBidCoins',
      'platformFeePercent',
    ]
      .map((key) => f(key, 'number'))
      .concat(f('campaignReviewRequired', 'boolean')),
  },
  seo: {
    label: 'SEO settings',
    description:
      'Global search metadata, indexing, crawler policy, and structured-data settings.',
    settings: true,
    endpoint: 'seo/settings',
    edit: [
      f('siteName'),
      ...[
        'defaultTitle',
        'defaultDescription',
        'defaultOgImageKey',
        'twitterSite',
        'googleSiteVerification',
        'bingSiteVerification',
        'yandexSiteVerification',
        'robotsTxtCustom',
        'organizationName',
        'organizationUrl',
        'organizationLogoKey',
        'llmsTxtContent',
        'indexNowKeyLocation',
      ].map(text),
      ...[
        'sitemapEnabled',
        'aiCrawlersAllowed',
        'aiTrainingAllowed',
        'llmsTxtEnabled',
        'indexNowEnabled',
        'speakableEnabled',
        'faqEnabled',
        'howtoEnabled',
      ].map((key) => f(key, 'boolean')),
      f('sitemapChangefreq', 'select', false, [
        'always',
        'hourly',
        'daily',
        'weekly',
        'monthly',
        'yearly',
        'never',
      ]),
      f('sitemapPriority', 'number'),
      f('freshnessThresholdDays', 'number'),
      ...[
        'organizationSameAs',
        'aiCrawlerUserAgents',
        'speakableCssSelectors',
      ].map((key) => json(key)),
      f('indexNowKey', 'password'),
    ],
  },
};
export const ADMIN_SCHEMA_SCRIPT = `window.MATJARY_ADMIN = ${JSON.stringify({ views: ADMIN_VIEWS, metadata: { stores: [...metadata, text('ogSiteName'), text('twitterSite'), text('twitterCreator')], products: [...metadata, text('gtin'), text('mpn'), text('brand'), text('sku')], posts: [...metadata, text('articleAuthor'), text('articleSection'), json('articleTags'), f('articlePublishedTime', 'date', false, undefined, true), f('articleModifiedTime', 'date', false, undefined, true)] } })};`;
