import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  contrastColor,
  defaults,
  mediaUrl,
  normalizeSettings,
  readSavedIds,
  safeUrl,
} from './website.ts';

test('branding uses public settings and rejects malformed values', () => {
  const settings = normalizeSettings({
    siteName: '  My Store  ',
    primaryColor: '#123abc',
    secondaryColor: 'red',
    logoUrl: 'javascript:alert(1)',
    bannerUrl: '/api/v1/uploads/a%2Fb',
    tagline: null,
    footerText: 'Welcome',
    password: 'not-public',
  });
  assert.equal(settings.siteName, 'My Store');
  assert.equal(settings.primaryColor, '#123abc');
  assert.equal(settings.secondaryColor, defaults.secondaryColor);
  assert.equal(settings.logoUrl, null);
  assert.equal(settings.bannerUrl, '/api/v1/uploads/a%2Fb');
  assert.equal(settings.tagline, null);
  assert.equal(settings.footerText, 'Welcome');
  assert.equal('password' in settings, false);
  assert.deepEqual(normalizeSettings(null), defaults);
});

test('media stays authorized through the proxy and preserves encoded keys', () => {
  assert.equal(
    mediaUrl(
      'http://localhost:3000/api/v1/uploads/A%2Fb.webp',
      'http://localhost:3000',
    ),
    '/api/v1/uploads/A%2Fb.webp',
  );
  assert.equal(
    mediaUrl(
      'http://127.0.0.1:3000/api/v1/uploads/A%2Fb.webp',
      'http://localhost:3000',
    ),
    '/api/v1/uploads/A%2Fb.webp',
  );
  assert.equal(
    mediaUrl('https://cdn.example.com/image.webp', 'http://localhost:3000'),
    'https://cdn.example.com/image.webp',
  );
  assert.equal(
    mediaUrl('/api/v1/uploads/a%2Fb', null),
    '/api/v1/uploads/a%2Fb',
  );
  for (const unsafe of [
    '//evil.example/image',
    '/\\evil.example',
    'javascript:alert(1)',
    'https://user:password@example.com/image',
  ])
    assert.equal(safeUrl(unsafe), undefined);
});

test('saved IDs tolerate blocked storage and malformed or oversized data', () => {
  assert.deepEqual(
    readSavedIds({
      getItem: () => {
        throw new Error('blocked');
      },
    }),
    [],
  );
  assert.deepEqual(readSavedIds({ getItem: () => '{broken' }), []);
  assert.deepEqual(readSavedIds({ getItem: () => '["1",null,2,"1","3"]' }), [
    '1',
    '3',
  ]);
  assert.equal(
    readSavedIds({
      getItem: () =>
        JSON.stringify(Array.from({ length: 600 }, (_, i) => String(i))),
    }).length,
    500,
  );
});

test('buttons choose readable text for light and dark brand colors', () => {
  assert.equal(contrastColor('#ffffff'), '#17231e');
  assert.equal(contrastColor('#254e40'), '#ffffff');
  assert.equal(contrastColor('#000000'), '#ffffff');
});
