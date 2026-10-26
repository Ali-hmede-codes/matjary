import 'reflect-metadata';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import {
  isShareCrawler,
  renderShareDocument,
} from '../../apps/api/src/modules/seo/share-document';
import type { MetaTags } from '../../apps/api/src/modules/seo/seo.service';
import {
  renderShareShell,
  shareShellSegments,
} from '../../apps/api/src/modules/seo/share-shell';
import { ShareShellService } from '../../apps/api/src/modules/seo/share-shell.service';
import { choosePreviewImage } from '../../apps/api/src/modules/seo/preview-image';
import {
  Product,
  Store,
  StoreCategory,
} from '../../libs/database/src/entities';

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
  assert.doesNotMatch(html, /Discover independent stores/u);
  assert.equal((html.match(/<title>/gu) ?? []).length, 1);
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
    const manager = {
      find: async (target: unknown) =>
        target === Store
          ? [store]
          : target === StoreCategory
            ? [category]
            : target === Product
              ? [product]
              : [],
      count: async () => 0,
    };
    const seo = {
      generateStoreMetaTags: async () => meta,
      generateCategoryMetaTags: async () => meta,
      generateUncategorizedShareMeta: async () => meta,
      generateProductMetaTags: async () => meta,
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
    assert.equal(await service.refreshAll(), 3);
    for (const relative of [
      'alabdalla/index.html',
      'alabdalla/c/offers/index.html',
      'alabdalla/p/item-x/index.html',
    ]) {
      const html = await fs.readFile(path.join(root, relative), 'utf8');
      assert.match(html, /<meta property="og:title" content="Offers/u);
      assert.doesNotMatch(html, />Default</u);
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
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
