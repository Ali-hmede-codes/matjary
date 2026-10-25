import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isShareCrawler,
  renderShareDocument,
} from '../../apps/api/src/modules/seo/share-document';
import type { MetaTags } from '../../apps/api/src/modules/seo/seo.service';

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
