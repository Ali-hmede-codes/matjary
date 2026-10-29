import assert from 'node:assert/strict';
import { test } from 'node:test';
import { qrFileName, qrLogoPlate, shopShareUrl } from './shop-qr.ts';

test('shop QR links always target the public storefront', () => {
  assert.equal(
    shopShareUrl('https://matjary.com', 'my-shop'),
    'https://matjary.com/stores/my-shop',
  );
  assert.equal(
    shopShareUrl('http://127.0.0.1:5173/', 'shop-2'),
    'http://127.0.0.1:5173/stores/shop-2',
  );
  for (const slug of ['', 'My Shop', '../admin', 'shop/extra', 'a'.repeat(192)])
    assert.equal(shopShareUrl('https://matjary.com', slug), null, slug);
  assert.equal(shopShareUrl('javascript:alert(1)', 'shop'), null);
  assert.equal(shopShareUrl('not a url', 'shop'), null);
});

test('the logo plate stays inside what level-H correction rebuilds', () => {
  for (const size of [256, 512, 1024, 2048]) {
    const { plate, padding, radius } = qrLogoPlate(size);
    assert.ok(plate < size * 0.3, `plate ${plate} of ${size}`);
    assert.ok(padding > 0 && padding < plate / 4);
    assert.ok(radius > 0 && radius < plate / 2);
  }
});

test('downloaded cards use a filesystem-safe name', () => {
  assert.equal(qrFileName('my-shop'), 'my-shop-qr.png');
  assert.equal(qrFileName(' My Shop '), 'shop-qr.png');
  assert.equal(qrFileName(''), 'shop-qr.png');
});
