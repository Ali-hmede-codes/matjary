import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// A plain static host serves these files verbatim before its SPA fallback, so a
// shipped copy is the only thing that stops /robots.txt and /sitemap.xml from
// returning the app's HTML to crawlers.
const read = (name: string) =>
  readFileSync(new URL(`../../public/${name}`, import.meta.url), 'utf8');

test('robots.txt is a real robots file that points at the published sitemap', () => {
  const robots = read('robots.txt');
  assert.doesNotMatch(robots, /<html|<script/iu);
  assert.match(robots, /^User-agent: \*$/mu);
  assert.match(robots, /^Allow: \/$/mu);
  const sitemaps = robots.match(/^Sitemap: .+$/gmu) ?? [];
  assert.deepEqual(sitemaps, ['Sitemap: https://matgari.app/sitemap.xml']);
  // Every advertised address must be absolute; a relative one is ignored.
  for (const line of sitemaps)
    assert.match(line, /^Sitemap: https:\/\/[^ ]+$/u);
});

test('sitemap.xml is a valid index over the live API sitemap', () => {
  const sitemap = read('sitemap.xml');
  assert.doesNotMatch(sitemap, /<html|<script/iu);
  assert.match(sitemap, /^<\?xml version="1\.0" encoding="UTF-8"\?>/u);
  assert.match(
    sitemap,
    /<sitemapindex xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/u,
  );
  const locations = sitemap.match(/<loc>[^<]+<\/loc>/gu) ?? [];
  assert.deepEqual(locations, [
    '<loc>https://matgari.app/api/v1/seo/sitemap.xml</loc>',
  ]);
  assert.match(sitemap, /<\/sitemapindex>\s*$/u);
});
