import 'reflect-metadata';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { ConfigService } from '@nestjs/config';
import {
  isShareCrawler,
  renderShareDocument,
} from '../../apps/api/src/modules/seo/share-document';
import type { MetaTags } from '../../apps/api/src/modules/seo/seo.service';
import { SeoService } from '../../apps/api/src/modules/seo/seo.service';
import {
  renderShareShell,
  shareShellSegments,
} from '../../apps/api/src/modules/seo/share-shell';
import { ShareShellService } from '../../apps/api/src/modules/seo/share-shell.service';
import { choosePreviewImage } from '../../apps/api/src/modules/seo/preview-image';
import {
  MediaAsset,
  MediaVariant,
  Product,
  Showcase,
  ShowcaseStatus,
  Store,
  StoreCategory,
  StoreType,
} from '../../libs/database/src/entities';
import { WebsiteSettings } from '../../libs/database/src/website-settings.entity';
import {
  StoreSeo,
  ProductSeo,
  ShowcaseSeo,
  SeoSettings,
} from '../../libs/database/src/seo.entities';
import { Readable } from 'node:stream';

const canonical = 'https://matjary.test/stores/alabdalla/c/offers';
const meta: MetaTags = {
  title: 'Offers — Alabdalla',
  description: '2 items in Offers at Alabdalla.',
  robots: 'index, follow',
  canonical,
  og: {
    title: 'Offers — Alabdalla',
    description: '2 items in Offers at Alabdalla.',
    image: 'https://matjary.test/api/v1/uploads/store%2Fbanner.webp',
    type: 'website',
    siteName: 'Matjary',
    url: canonical,
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Offers — Alabdalla',
    description: '2 items in Offers at Alabdalla.',
    image: 'https://matjary.test/api/v1/uploads/store%2Fbanner.webp',
  },
};

test('share documents carry the page tags and forward real browsers', () => {
  const html = renderShareDocument(meta, canonical);
  assert.match(
    html,
    /<meta property="og:title" content="Offers — Alabdalla">/u,
  );
  assert.match(
    html,
    /<meta property="og:url" content="https:\/\/matjary\.test/u,
  );
  assert.match(
    html,
    /<meta property="og:image" content="https:\/\/matjary\.test/u,
  );
  assert.match(
    html,
    /<meta name="twitter:card" content="summary_large_image">/u,
  );
  assert.match(html, /<link rel="canonical" href="https:\/\/matjary\.test/u);
  assert.ok(html.includes(`location.replace("${canonical}")`));
});

test('crawler documents never include the browser redirect', () => {
  const html = renderShareDocument(meta);
  assert.doesNotMatch(html, /location\.replace/u);
  assert.match(
    html,
    /<meta property="og:title" content="Offers — Alabdalla">/u,
  );
});

test('owner-authored values cannot break out of the document', () => {
  const hostile = '"><script>alert(1)</script>';
  const html = renderShareDocument(
    {
      ...meta,
      title: hostile,
      canonical: `https://matjary.test/stores/x${hostile}`,
      og: { ...meta.og, title: hostile },
      twitter: { ...meta.twitter, title: hostile },
    },
    `https://matjary.test/stores/x${hostile}`,
  );
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/u);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/u);
  // The redirect literal escapes '<' so it cannot close the script element.
  assert.match(html, /\\u003cscript>/u);
});

test('storefront shells inject preview tags into the published SPA document', () => {
  const template =
    '<!doctype html><html><head><title>Matjary — Discover something good</title>' +
    '<meta name="description" content="Discover independent stores, beautiful finds, and everyday inspiration on Matjary.">' +
    '<meta property="og:title" content="Matjary — Discover something good">' +
    '<meta property="og:image" content="/banner.jpg">' +
    '<script type="module" src="/assets/index.js"></script></head>' +
    '<body><div id="root"></div></body></html>';
  const html = renderShareShell(template, meta);
  assert.match(html, /<title>Offers — Alabdalla<\/title>/u);
  assert.match(
    html,
    /<meta property="og:title" content="Offers — Alabdalla">/u,
  );
  assert.match(html, /<link rel="canonical" href="https:\/\/matjary\.test/u);
  assert.match(html, /src="\/assets\/index\.js"/u);
  // The boot script must see the marker before it runs while parsing the head.
  assert.ok(
    html.indexOf('name="matjary-shell"') < html.indexOf('/assets/index.js'),
  );
  assert.doesNotMatch(html, /Discover independent stores/u);
  assert.equal((html.match(/<title>/gu) ?? []).length, 1);
  // The template's own default image must not survive next to the page's.
  assert.equal((html.match(/property="og:image"/gu) ?? []).length, 1);
  assert.doesNotMatch(html, /\/banner\.jpg/u);
});

test('shell path segments only accept storefront slugs', () => {
  assert.deepEqual(shareShellSegments('alabdalla', 'c', 'offers'), [
    'alabdalla',
    'c',
    'offers',
  ]);
  assert.deepEqual(shareShellSegments('alabdalla', 'p', 'item-x'), [
    'alabdalla',
    'p',
    'item-x',
  ]);
  for (const segments of [
    [],
    ['UPPER'],
    ['..'],
    ['a/b'],
    ['-leading'],
    ['x'.repeat(192)],
  ])
    assert.equal(shareShellSegments(...segments), null);
});

test('share images prefer compact JPEGs that preview clients accept', () => {
  const variants = [
    { mimeType: 'image/avif', width: 1600, sizeBytes: '90000' },
    { mimeType: 'image/jpeg', width: 1600, sizeBytes: '520000' },
    { mimeType: 'image/jpeg', width: 1080, sizeBytes: '240000' },
    { mimeType: 'image/jpeg', width: 480, sizeBytes: '70000' },
    { mimeType: 'image/webp', width: 1080, sizeBytes: '100000' },
  ];
  assert.equal(choosePreviewImage(variants)?.width, 1080);
  assert.equal(choosePreviewImage(variants)?.mimeType, 'image/jpeg');
  // Nothing fits the limit: the smallest JPEG still beats WebP/AVIF.
  assert.equal(
    choosePreviewImage(variants.filter((entry) => entry.width === 1600))
      ?.mimeType,
    'image/jpeg',
  );
  assert.equal(
    choosePreviewImage(variants.filter((entry) => entry.width === 480))?.width,
    480,
  );
  // No JPEG or PNG at all still yields a usable image fallback.
  assert.equal(choosePreviewImage([variants[0]!])?.mimeType, 'image/avif');
  // Legacy rows without sizes fall back to the smallest JPEG.
  assert.equal(
    choosePreviewImage([
      { mimeType: 'image/jpeg', width: 1600, sizeBytes: '0' },
      { mimeType: 'image/jpeg', width: 480, sizeBytes: '0' },
    ])?.width,
    480,
  );
});

test('a shared post previews with its own photo or video poster', async () => {
  const logoAsset = '11111111-1111-4111-8111-111111111111';
  const videoAsset = '22222222-2222-4222-8222-222222222222';
  const photoAsset = '33333333-3333-4333-8333-333333333333';
  const storeLogoKey = `media/store-1/${logoAsset}/jpeg-1080.jpg`;
  const photoKey = `media/post-1/${photoAsset}/jpeg-1080.jpg`;
  const posterKey = `media/post-1/${videoAsset}/poster-jpeg.jpg`;
  const settings = {
    siteName: 'Matjary',
    defaultTitle: null,
    defaultDescription: null,
    defaultOgImageKey: null,
    twitterSite: null,
  };
  // Legacy auto-generation stored the shop logo in a post's ogImageKey, which
  // then outranked the post's media in every preview.
  const seoRow: Record<string, unknown> = {
    metaTitle: null,
    metaDescription: null,
    canonicalUrl: null,
    ogTitle: null,
    ogDescription: null,
    ogImageKey: storeLogoKey,
    robots: 'index, follow',
    aiRobots: null,
    aiTraining: null,
    articleTags: null,
  };
  const videoVariants = [
    {
      assetId: videoAsset,
      storageKey: `media/post-1/${videoAsset}/mp4-720.mp4`,
      mimeType: 'video/mp4',
      width: 1280,
      height: 720,
      sizeBytes: '900000',
    },
    {
      assetId: videoAsset,
      storageKey: posterKey,
      mimeType: 'image/jpeg',
      width: 1280,
      height: 720,
      sizeBytes: '120000',
    },
  ];
  let assets: { id: string }[] = [{ id: videoAsset }];
  let variants = videoVariants;
  const manager = {
    findOneBy: async () => null,
    find: async (target: unknown) =>
      target === MediaAsset ? assets : target === MediaVariant ? variants : [],
    findOne: async (
      target: unknown,
      options?: { where?: { storageKey?: string } },
    ) => {
      if (target !== MediaVariant) return null;
      return (
        variants.find(
          (variant) => variant.storageKey === options?.where?.storageKey,
        ) ?? null
      );
    },
    // Only this post's own media counts; the shop logo belongs elsewhere.
    exists: async (_target: unknown, options?: { where?: { id?: string } }) =>
      assets.some((asset) => asset.id === options?.where?.id),
  };
  const repository = {
    findOneBy: async () => seoRow,
    find: async () => [settings],
  };
  const storage = {
    presignedGetUrl: async (key: string) =>
      `https://matjary.test/api/v1/uploads/${encodeURIComponent(key)}`,
    statObject: async () => {
      throw new Error('no card');
    },
  };
  const service = new SeoService(
    repository as never,
    repository as never,
    repository as never,
    repository as never,
    repository as never,
    new ConfigService({ APP_ORIGIN: 'https://matjary.test' }) as never,
    { manager } as never,
    {} as never,
    storage as never,
  );
  const post = {
    id: 'post-1',
    slug: 'spring-drop',
    title: 'Spring drop',
    description: 'New arrivals',
    status: ShowcaseStatus.PUBLISHED,
    storeId: 'store-1',
    publishedAt: new Date('2026-10-01T10:00:00Z'),
    createdAt: new Date('2026-10-01T10:00:00Z'),
    updatedAt: new Date('2026-10-01T10:00:00Z'),
  } as Showcase;
  const store = {
    id: 'store-1',
    slug: 'olive',
    name: 'Olive',
    logoKey: storeLogoKey,
    bannerKey: null,
  } as Store;

  // A video-only post previews with the poster frame the feed shows.
  const videoOnly = await service.generateShowcaseMetaTags(post, store);
  assert.equal(
    videoOnly.og.image,
    `https://matjary.test/api/v1/uploads/${encodeURIComponent(posterKey)}`,
  );
  assert.equal(videoOnly.twitter.image, videoOnly.og.image);
  assert.equal(
    videoOnly.jsonLd?.[0]?.image,
    `https://matjary.test/api/v1/uploads/${encodeURIComponent(posterKey)}`,
  );

  // An owner-saved post image is honored while it still belongs to the post.
  assets = [{ id: photoAsset }];
  variants = [
    {
      assetId: photoAsset,
      storageKey: photoKey,
      mimeType: 'image/jpeg',
      width: 1080,
      height: 1080,
      sizeBytes: '180000',
    },
    {
      assetId: photoAsset,
      storageKey: `media/post-1/${photoAsset}/avif-1600.avif`,
      mimeType: 'image/avif',
      width: 1600,
      height: 1600,
      sizeBytes: '90000',
    },
  ];
  seoRow.ogImageKey = photoKey;
  const withSavedImage = await service.generateShowcaseMetaTags(post, store);
  assert.equal(
    withSavedImage.og.image,
    `https://matjary.test/api/v1/uploads/${encodeURIComponent(photoKey)}`,
  );
});

test('menu shops read as a menu in share metadata', async () => {
  const settings = {
    siteName: 'Matjary',
    defaultTitle: null,
    defaultDescription: 'Discover independent stores.',
    defaultOgImageKey: null,
    defaultOgImageUrl: 'https://cdn.test/share.jpg',
    twitterSite: null,
  };
  const seoRow: Record<string, unknown> = {
    metaTitle: null,
    metaDescription: 'Home-style Syrian food.',
    ogTitle: null,
    ogDescription: null,
    ogImageKey: null,
    robots: 'index, follow',
    aiRobots: null,
    aiTraining: null,
  };
  const repository = {
    findOneBy: async () => seoRow,
    find: async () => [settings],
  };
  const manager = {
    findOneBy: async () => null,
    count: async () => 12,
    find: async () => [],
    findOne: async () => null,
  };
  const service = new SeoService(
    repository as never,
    repository as never,
    repository as never,
    repository as never,
    repository as never,
    new ConfigService({ APP_ORIGIN: 'https://matjary.test' }) as never,
    { manager } as never,
    {} as never,
    {} as never,
  );
  const store = {
    id: 'store-1',
    slug: 'alabdalla',
    name: 'Alabdalla',
    description: 'Home-style Syrian food.',
    storeType: StoreType.RESTAURANT_MENU,
    logoKey: null,
    bannerKey: null,
  } as Store;

  const menu = await service.generateStoreMetaTags(store);
  assert.equal(menu.title, 'Alabdalla — Menu | Matjary');
  assert.equal(menu.og.title, 'Alabdalla — Menu');
  // The administrator's URL is used when the shop has no image of its own.
  assert.equal(menu.og.image, 'https://cdn.test/share.jpg');
  assert.equal(menu.twitter.image, 'https://cdn.test/share.jpg');
  // A same-origin logo path becomes an absolute preview address.
  settings.defaultOgImageUrl = '/logo.png';
  const relative = await service.generateStoreMetaTags(store);
  assert.equal(relative.og.image, 'https://matjary.test/logo.png');
  assert.match(
    menu.description,
    /^Browse the menu — 12 items with prices and photos\. Home-style Syrian food\.$/u,
  );
  assert.match(menu.og.description, /^Browse the menu — 12 items/u);
  assert.match(menu.twitter.description, /^Browse the menu — 12 items/u);

  // Owner copy that already mentions the menu is never rewritten.
  seoRow.metaDescription = 'Our menu changes every week.';
  const ownerMenu = await service.generateStoreMetaTags(store);
  assert.equal(ownerMenu.description, 'Our menu changes every week.');

  // Retail shops keep the generic shop metadata.
  seoRow.metaDescription = 'Home-style Syrian food.';
  const retail = await service.generateStoreMetaTags({
    ...store,
    storeType: StoreType.ECOMMERCE,
  });
  assert.equal(retail.title, 'Alabdalla | Matjary');
  assert.equal(retail.description, 'Home-style Syrian food.');
});

test('the shared site link follows live website branding', async () => {
  const settings: Record<string, unknown> = {
    siteName: 'Matjary',
    defaultTitle: 'Matjary - Your Showcase Platform',
    defaultDescription: null,
    defaultOgImageKey: null,
    defaultOgImageUrl: '/logo.png',
    twitterSite: null,
    organizationName: null,
    organizationUrl: null,
    organizationLogoKey: null,
    organizationLogoUrl: null,
    organizationSameAs: null,
    googleSiteVerification: null,
    bingSiteVerification: null,
    yandexSiteVerification: null,
  };
  const branding = Object.assign(new WebsiteSettings(), {
    siteName: 'Sooq',
    tagline: 'Made in Lebanon',
    description: 'Handmade finds from Lebanese makers.',
    bannerUrl: '/banner.jpg',
    logoUrl: '/logo.png',
  });
  const repository = { find: async () => [settings] };
  const manager = {
    findOneBy: async (target: unknown) =>
      target === WebsiteSettings ? branding : null,
  };
  const service = new SeoService(
    repository as never,
    repository as never,
    repository as never,
    repository as never,
    repository as never,
    new ConfigService({ APP_ORIGIN: 'https://matjary.test' }) as never,
    { manager } as never,
    {} as never,
    {} as never,
  );

  const home = await service.generateSiteMetaTags();
  // A previously saved default title must not freeze the home card after a
  // rename; the website name and tagline are the home identity.
  assert.equal(home.title, 'Sooq — Made in Lebanon');
  assert.equal(home.description, 'Handmade finds from Lebanese makers.');
  // The administrator's sharing image wins over the website banner.
  assert.equal(home.og.image, 'https://matjary.test/logo.png');
  assert.equal(home.og.siteName, 'Sooq');
  assert.equal(home.canonical, 'https://matjary.test');
  assert.equal(home.og.url, 'https://matjary.test');

  // Sharing the root must not send the crawler to the same URL again.
  const html = await service.renderShareHtml('');
  assert.match(
    html,
    /<meta property="og:title" content="Sooq — Made in Lebanon">/u,
  );
  assert.doesNotMatch(html, /location\.replace/u);
  assert.match(html, /<link rel="canonical" href="https:\/\/matjary\.test">/u);
  // Structured data ships in the first response for search engines.
  assert.match(html, /<script type="application\/ld\+json">/u);
  assert.match(html, /"@type":"WebSite"/u);
});

test('the refresher writes one shell per public storefront page', async () => {
  await fs.mkdir('.tmp', { recursive: true });
  const directory = await fs.mkdtemp(path.join('.tmp', 'share-shell-'));
  try {
    const templatePath = path.join(directory, 'index.html');
    await fs.writeFile(
      templatePath,
      '<!doctype html><html><head><title>Default</title></head>' +
        '<body><div id="root"></div></body></html>',
    );
    const root = path.join(directory, 'stores');
    const store = { id: 'store-1', slug: 'alabdalla' };
    const category = { id: 'category-1', name: 'Offers', sortOrder: 1 };
    const product = { id: 'product-1', slug: 'item-x' };
    const post = { id: 'post-1', slug: 'spring-drop' };
    let products = [product];
    const manager = {
      find: async (target: unknown) =>
        target === Store
          ? [store]
          : target === StoreCategory
            ? [category]
            : target === Product
              ? products
              : target === Showcase
                ? [post]
                : [],
      count: async () => 0,
    };
    let siteTitle = 'Current site title';
    const seo = {
      getPageMeta: async () => ({ ...meta, title: siteTitle }),
      generateStoreMetaTags: async () => meta,
      generateCategoryMetaTags: async () => meta,
      generateUncategorizedShareMeta: async () => meta,
      generateProductMetaTags: async () => meta,
      generateShowcaseMetaTags: async () => meta,
      categoryPathSlug: (name: string) => name.toLowerCase(),
    };
    const config = new ConfigService({
      SHARE_SHELL_TEMPLATE: templatePath,
      SHARE_SHELL_ROOT: root,
      SHARE_SHELL_REFRESH_SECONDS: 120,
      SHARE_SHELL_TOKEN: '',
    });
    const service = new ShareShellService(
      { manager, query: async () => [{ stores: 1 }] } as never,
      seo as never,
      config as never,
    );
    assert.equal(await service.refreshAll(), 10);
    for (const page of [
      'home',
      'shops',
      'pricing',
      'terms',
      'privacy',
      'favorites',
    ]) {
      assert.match(
        await fs.readFile(path.join(root, '.site', page, 'index.html'), 'utf8'),
        /<title>Current site title<\/title>/u,
      );
    }
    for (const relative of [
      'alabdalla/index.html',
      'alabdalla/c/offers/index.html',
      'alabdalla/p/item-x/index.html',
      'alabdalla/post/spring-drop/index.html',
    ]) {
      const html = await fs.readFile(path.join(root, relative), 'utf8');
      assert.match(html, /<meta property="og:title" content="Offers/u);
      assert.doesNotMatch(html, />Default</u);
    }

    // A page dropped from the catalogue, and a leftover from an older slug,
    // must both stop answering with their old metadata.
    await fs.mkdir(path.join(root, 'old-shop'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'old-shop', 'index.html'),
      '<title>Old shop</title>',
    );
    products = [];
    siteTitle = 'Renamed site';
    assert.equal(await service.refreshAll(), 9);
    assert.match(
      await fs.readFile(path.join(root, '.site', 'home', 'index.html'), 'utf8'),
      /<title>Renamed site<\/title>/u,
    );
    for (const relative of [
      'alabdalla/p/item-x/index.html',
      'alabdalla/p/item-x',
      'old-shop/index.html',
      'old-shop',
    ])
      await assert.rejects(fs.access(path.join(root, relative)));
    await fs.access(path.join(root, 'alabdalla', 'index.html'));
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

async function shellSchedulerFixture(t: TestContext, withTemplate = true) {
  await fs.mkdir('.tmp', { recursive: true });
  const directory = await fs.mkdtemp(path.join('.tmp', 'shell-scheduler-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const templatePath = path.join(directory, 'template.html');
  if (withTemplate) await fs.writeFile(templatePath, '<html>template</html>');
  const state = {
    revision: 1,
    scans: 0,
    passes: 0,
    onScan: undefined as (() => Promise<void>) | undefined,
    onPass: undefined as (() => Promise<void>) | undefined,
  };
  const service = new ShareShellService(
    {
      query: async () => {
        state.scans++;
        const snapshot = [{ revision: state.revision }];
        await state.onScan?.();
        return snapshot;
      },
    } as never,
    {} as never,
    new ConfigService({
      SHARE_SHELL_TEMPLATE: templatePath,
      SHARE_SHELL_ROOT: path.join(directory, 'stores'),
      SHARE_SHELL_REFRESH_SECONDS: 120,
    }) as never,
  );
  t.after(() => service.onApplicationShutdown());
  const scheduler = service as unknown as {
    pending?: Promise<number>;
    refreshIfNeeded(): Promise<number>;
    runRefresh(template: string): Promise<number>;
  };
  t.mock.method(scheduler, 'runRefresh', async () => {
    state.passes++;
    await state.onPass?.();
    return 1;
  });
  return { service, scheduler, state, templatePath };
}

test('shell scheduling skips unchanged polls and keeps hourly recovery and forced refreshes', async (t) => {
  const { service, scheduler, state } = await shellSchedulerFixture(t);
  t.mock.timers.enable({
    apis: ['setTimeout', 'setInterval', 'Date'],
    now: 1_800_000_000_000,
  });
  service.onModuleInit();
  t.mock.timers.tick(10_000);
  await scheduler.pending;
  assert.equal(state.passes, 1);
  assert.equal(state.scans, 1);

  // There must be no independent 15-second database watcher.
  t.mock.timers.tick(15_000);
  assert.equal(state.scans, 1);
  t.mock.timers.tick(95_000);
  await scheduler.pending;
  assert.equal(state.scans, 2);
  assert.equal(state.passes, 1);

  state.revision++;
  t.mock.timers.tick(120_000);
  await scheduler.pending;
  assert.equal(state.passes, 2);
  assert.equal(await service.refreshAll(), 1);
  assert.equal(state.passes, 3);

  t.mock.timers.setTime(Date.now() + 60 * 60_000);
  assert.equal(await scheduler.refreshIfNeeded(), 1);
  assert.equal(state.passes, 4);
});

test('shell refreshes are database-idle without a usable template and recover when it appears', async (t) => {
  const { service, scheduler, state, templatePath } =
    await shellSchedulerFixture(t, false);
  assert.equal(await service.refreshAll(), 0);
  await fs.writeFile(templatePath, '');
  assert.equal(await scheduler.refreshIfNeeded(), 0);
  assert.equal(state.scans, 0);
  assert.equal(state.passes, 0);

  await fs.writeFile(templatePath, '<html>available</html>');
  assert.equal(await scheduler.refreshIfNeeded(), 1);
  assert.equal(state.scans, 1);
  assert.equal(state.passes, 1);
  await fs.writeFile(templatePath, '<html>new deployed template</html>');
  assert.equal(await scheduler.refreshIfNeeded(), 1);
  assert.equal(state.passes, 2);
});

test('shell polls share slow queries and retain changes and requests arriving during a pass', async (t) => {
  const { service, scheduler, state } = await shellSchedulerFixture(t);
  let release!: () => void;
  let started!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const scanning = new Promise<void>((resolve) => {
    started = resolve;
  });
  state.onScan = async () => {
    started();
    await blocked;
  };
  state.onPass = async () => {
    state.revision++;
  };
  const first = scheduler.refreshIfNeeded();
  const second = scheduler.refreshIfNeeded();
  assert.equal(first, second);
  await scanning;
  assert.equal(state.scans, 1);
  release();
  await first;
  assert.equal(state.passes, 1);

  state.onScan = undefined;
  state.onPass = undefined;
  // The pass must not acknowledge a newer fingerprint sampled after its work.
  assert.equal(await scheduler.refreshIfNeeded(), 1);
  assert.equal(state.passes, 2);
  assert.equal(await scheduler.refreshIfNeeded(), 0);

  state.onPass = async () => {
    void service.refreshAll();
  };
  await service.refreshAll();
  state.onPass = undefined;
  assert.equal(await scheduler.refreshIfNeeded(), 1);
  assert.equal(state.passes, 4);
  assert.equal(await scheduler.refreshIfNeeded(), 0);
});

test('a failed forced shell refresh remains retryable with an unchanged fingerprint', async (t) => {
  const { service, scheduler, state } = await shellSchedulerFixture(t);
  await service.refreshAll();
  state.onPass = async () => {
    throw new Error('simulated render failure');
  };
  await assert.rejects(service.refreshAll(), /simulated render failure/u);
  state.onPass = undefined;
  assert.equal(await scheduler.refreshIfNeeded(), 1);
  assert.equal(state.passes, 3);
  assert.equal(await scheduler.refreshIfNeeded(), 0);
});

function liveSeoFixture() {
  const branding = Object.assign(new WebsiteSettings(), {
    siteName: 'New brand',
    tagline: 'Fresh finds',
    description: 'Live website description',
    bannerUrl: '/new-banner.jpg',
  });
  const settings: SeoSettings = Object.assign(new SeoSettings(), {
    siteName: 'Old brand',
    defaultTitle: null,
    defaultDescription: null,
  });
  const store = Object.assign(new Store(), {
    id: '22222222-2222-4222-8222-222222222222',
    slug: 'shop',
    name: 'Current shop',
    description: 'Current shop description',
    storeType: StoreType.ECOMMERCE,
    logoKey:
      'media/22222222-2222-4222-8222-222222222222/11111111-1111-4111-8111-111111111111/jpeg-1080.jpg',
    bannerKey: 'banner-key',
  });
  const storeSeo: StoreSeo = Object.assign(new StoreSeo(), {
    storeId: store.id,
    metaTitle: 'Old shop | Old brand',
    ogTitle: 'Old shop',
    metaDescription: 'Old description',
    ogDescription: 'Old description',
    ogSiteName: 'Old brand',
    ogImageKey: store.logoKey,
    autoGeneratedFields: [
      'metaTitle',
      'ogTitle',
      'metaDescription',
      'ogDescription',
      'ogSiteName',
      'ogImageKey',
    ],
  });
  const productSeo = Object.assign(new ProductSeo(), {
    metaTitle: 'Old item | Old brand',
    ogTitle: 'Old item',
    autoGeneratedFields: ['metaTitle', 'ogTitle'],
  });
  const postSeo = Object.assign(new ShowcaseSeo(), {
    metaTitle: 'Old post | Old brand',
    ogTitle: 'Old post',
    autoGeneratedFields: ['metaTitle', 'ogTitle'],
  });
  const state = {
    card: true,
    brandCard: false,
    public: true,
    writes: 0,
  };
  const repo = (row: object) => ({
    findOneBy: async () => row,
    find: async () => [settings],
    save: async (value: unknown) => {
      state.writes++;
      return value;
    },
  });
  const manager = {
    findOneBy: async (target: unknown) =>
      target === WebsiteSettings
        ? branding
        : target === Store && state.public
          ? store
          : null,
    findOne: async (
      target: unknown,
      options: { where: { storageKey?: string } },
    ) =>
      target === MediaVariant && options.where.storageKey
        ? {
            storageKey: options.where.storageKey,
            assetId: 'asset',
            mimeType: 'image/jpeg',
          }
        : null,
    find: async () => [],
    count: async () => 0,
    exists: async () => false,
  };
  const service = new SeoService(
    repo(storeSeo) as never,
    repo(productSeo) as never,
    repo(postSeo) as never,
    repo({}) as never,
    repo(settings) as never,
    new ConfigService({ APP_ORIGIN: 'https://matjary.test' }),
    { manager } as never,
    {} as never,
    {
      statObject: async (key: string) => {
        if (key.includes('/brand-')) {
          if (!state.brandCard) throw new Error('missing');
          return { size: 100 };
        }
        if (!state.card) throw new Error('missing');
        return { size: 100 };
      },
      openReadStream: async () => Readable.from(['jpeg']),
      presignedGetUrl: async (key: string) =>
        `https://matjary.test/api/v1/uploads/${encodeURIComponent(key)}`,
    } as never,
  );
  return {
    service,
    branding,
    settings,
    store,
    storeSeo,
    productSeo,
    postSeo,
    state,
  };
}

test('automatic metadata follows current content and branding without public writes', async () => {
  const { service, store, storeSeo, branding, state } = liveSeoFixture();
  const tags = await service.generateStoreMetaTags(store);
  assert.equal(tags.title, 'Current shop | New brand');
  assert.equal(tags.og.title, 'Current shop');
  assert.equal(tags.description, 'Current shop description');
  assert.equal(tags.og.siteName, 'New brand');
  assert.ok(
    tags.jsonLd?.some(
      (entry) => entry['@type'] === 'WebSite' && entry.name === 'New brand',
    ),
  );
  assert.equal(storeSeo.metaTitle, 'Old shop | Old brand');
  branding.siteName = 'Renamed again';
  store.name = 'Renamed shop';
  assert.equal(
    (await service.generateStoreMetaTags(store)).title,
    'Renamed shop | Renamed again',
  );
  const product = Object.assign(new Product(), {
    id: 'product-1',
    slug: 'item',
    name: 'Fresh item',
    status: 'active',
    priceCents: '100',
    currency: 'USD',
    imageKeys: [],
    stockQuantity: null,
  });
  assert.match(
    (await service.generateProductMetaTags(product, store)).title,
    /^Fresh item - Renamed shop \| Renamed again$/u,
  );
  const post = Object.assign(new Showcase(), {
    id: 'post-1',
    slug: 'post',
    title: 'Fresh post',
    status: ShowcaseStatus.PUBLISHED,
    updatedAt: new Date(),
    publishedAt: new Date(),
  });
  const postMeta = await service.generateShowcaseMetaTags(post, store);
  assert.equal(postMeta.title, 'Fresh post | Renamed again');
  assert.equal(
    (postMeta.jsonLd?.[0]?.publisher as { name: string }).name,
    'Renamed again',
  );
  assert.equal(state.writes, 0);
});

test('manual edits survive regeneration and partial DTOs do not erase other overrides', async () => {
  const { service, store, storeSeo } = liveSeoFixture();
  const editor = service as unknown as {
    applySeoInput(
      seo: StoreSeo,
      data: { metaTitle?: string; ogTitle?: string; metaDescription?: string },
    ): void;
  };
  editor.applySeoInput(storeSeo, {
    metaTitle: 'Handwritten title',
    ogTitle: undefined,
  });
  assert.equal(storeSeo.ogTitle, 'Old shop');
  assert.ok(!storeSeo.autoGeneratedFields?.includes('metaTitle'));
  assert.ok(storeSeo.autoGeneratedFields?.includes('ogTitle'));
  assert.equal(
    (await service.generateStoreMetaTags(store)).title,
    'Handwritten title',
  );
  await service.autoGenerateStoreSeo(store);
  assert.equal(
    (await service.generateStoreMetaTags(store)).title,
    'Handwritten title',
  );
});

test('store previews use generated cards before automatic logo/banner defaults and recover safely', async () => {
  const { service, store, storeSeo, state } = liveSeoFixture();
  const tags = await service.generateStoreMetaTags(store);
  assert.match(tags.og.image!, /\/seo\/og\/shop\.jpg\?v=11111111/u);
  assert.equal(tags.twitter.image, tags.og.image);
  const card = await service.openShareCard(store.slug);
  assert.equal(card?.size, 100);
  card?.stream.destroy();
  storeSeo.ogImageKey = 'custom.jpg';
  storeSeo.autoGeneratedFields = storeSeo.autoGeneratedFields!.filter(
    (key) => key !== 'ogImageKey',
  );
  assert.match(
    (await service.generateStoreMetaTags(store)).og.image!,
    /uploads\/custom.jpg$/u,
  );
  storeSeo.ogImageKey = null;
  state.card = false;
  assert.match(
    (await service.generateStoreMetaTags(store)).og.image!,
    /uploads\/banner-key$/u,
  );
  state.card = true;
  assert.match(
    (await service.generateStoreMetaTags(store)).og.image!,
    /\/seo\/og\//u,
  );
  state.public = false;
  assert.equal(await service.openShareCard(store.slug), undefined);
  await assert.rejects(service.getPageMeta('/stores/shop'), /Page not found/u);
});

test('a stale stored og site name never outranks the live website name', async () => {
  const { service, store, storeSeo, branding } = liveSeoFixture();
  // A row written before the rename may keep the old name outside the
  // auto-generated list; the shop is still branded with the current name.
  storeSeo.ogSiteName = 'Old brand';
  storeSeo.autoGeneratedFields = (storeSeo.autoGeneratedFields ?? []).filter(
    (key) => key !== 'ogSiteName',
  );
  assert.equal(
    (await service.generateStoreMetaTags(store)).og.siteName,
    'New brand',
  );
  branding.siteName = 'Renamed again';
  assert.equal(
    (await service.generateStoreMetaTags(store)).og.siteName,
    'Renamed again',
  );
});

test('SEO titles frozen under the previous brand yield to the live branding', async () => {
  const { service, settings, branding } = liveSeoFixture();
  // Earlier admin forms saved the branding prefill as a real override.
  for (const title of [
    'Old brand',
    'Old brand — Old tagline',
    'Old brand - Old tagline',
    // The tagline alone is not a complete home title either.
    'Fresh finds',
  ]) {
    settings.defaultTitle = title;
    assert.equal(
      (await service.getPageMeta('/')).title,
      'New brand — Fresh finds',
      title,
    );
  }
  settings.defaultTitle = 'Handpicked finds';
  assert.equal((await service.getPageMeta('/')).title, 'Handpicked finds');
  branding.siteName = 'Renamed again';
  assert.equal((await service.getPageMeta('/')).title, 'Handpicked finds');

  // The organization name prefilled by the old form follows the live brand.
  settings.organizationName = 'Old brand';
  const home = await service.getPageMeta('/');
  assert.equal(
    home.jsonLd?.find((entry) => entry['@type'] === 'Organization')?.name,
    'Renamed again',
  );
});

test('a shop without a logo still gets its own generated share card', async () => {
  const { service, store, state } = liveSeoFixture();
  state.brandCard = true;
  Object.assign(store, {
    logoKey: null,
    bannerKey: null,
    name: 'Sunday Studio',
    brandColor: '#204030',
  });
  const tags = await service.generateStoreMetaTags(store);
  assert.match(
    tags.og.image!,
    /\/seo\/og\/shop\.jpg\?v=brand-[0-9a-f]{12}-100$/u,
  );
  assert.equal(tags.twitter.image, tags.og.image);
  const card = await service.openShareCard(store.slug);
  assert.equal(card?.size, 100);
  card?.stream.destroy();
});

test('a shop with no image at all still advertises a usable preview picture', async () => {
  const { service, store, branding } = liveSeoFixture();
  Object.assign(store, { logoKey: null, bannerKey: null });
  Object.assign(branding, { bannerUrl: null, logoUrl: null });
  const tags = await service.generateStoreMetaTags(store);
  assert.equal(tags.og.image, 'https://matjary.test/banner.jpg');
  assert.equal(tags.twitter.image, tags.og.image);
});

test('saved global SEO overrides apply to home; clearing them inherits live branding', async () => {
  const { service, settings, branding } = liveSeoFixture();
  settings.defaultTitle = 'Custom search title';
  settings.defaultDescription = 'Custom search description';
  settings.defaultOgImageUrl = '/custom.jpg';
  const home = await service.getPageMeta('/');
  assert.equal(home.title, 'Custom search title');
  assert.equal(home.description, 'Custom search description');
  assert.equal(home.og.image, 'https://matjary.test/custom.jpg');
  settings.defaultTitle = null;
  settings.defaultDescription = null;
  settings.defaultOgImageUrl = null;
  branding.siteName = 'Another brand';
  assert.equal(
    (await service.getPageMeta('/')).title,
    'Another brand — Fresh finds',
  );
  assert.equal(
    (await service.getPageMeta('/')).og.image,
    'https://matjary.test/new-banner.jpg',
  );
  for (const route of ['shops', 'pricing', 'terms', 'privacy']) {
    const page = await service.getPageMeta(`/${route}?tracking=1`);
    assert.match(page.title, /Another brand$/u);
    assert.equal(page.canonical, `https://matjary.test/${route}`);
    const html = await service.renderShareHtml(route, 'WhatsApp');
    assert.match(html, /Another brand/u);
    assert.doesNotMatch(html, /location.replace/u);
  }
  for (const route of [
    '/admin',
    '/dashboard',
    '/unknown',
    '/stores/../private',
  ])
    await assert.rejects(service.getPageMeta(route), /Page not found/u);
});

test('link preview fetchers are recognised so they get no redirect', () => {
  for (const agent of [
    'WhatsApp/2.24.1 A',
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    'TelegramBot (like TwitterBot)',
    'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
    'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
  ])
    assert.equal(isShareCrawler(agent), true, agent);
  for (const agent of [
    undefined,
    '',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
  ])
    assert.equal(isShareCrawler(agent), false, String(agent));
});
