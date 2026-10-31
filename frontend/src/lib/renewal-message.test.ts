import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  renewalWhatsAppText,
  whatsAppDigits,
  whatsAppLink,
} from './renewal-message.ts';

test('the plan reminder names the owner, the plan, the date and the price', () => {
  const text = renewalWhatsAppText({
    kind: 'subscription',
    name: 'Samir Haddad',
    planName: 'Business',
    priceLabel: '$10.00',
    dueDate: '2026-11-01T12:00:00.000Z',
    siteName: 'Matjary',
  });
  assert.match(text, /Samir Haddad/u);
  assert.match(text, /Business/u);
  assert.match(text, /\$10\.00/u);
  assert.match(text, /بتاريخ/u);
  assert.doesNotMatch(text, /قريباً/u);
  assert.match(text, /Matjary/u);
  assert.match(text, /^مرحباً/u);
});

test('the badge reminder names the shop and falls back for a missing price', () => {
  const text = renewalWhatsAppText({
    kind: 'verification',
    name: 'Rana',
    storeName: 'Rana Flowers',
    planName: null,
    priceLabel: null,
    dueDate: '2026-11-02T12:00:00.000Z',
    siteName: null,
  });
  assert.match(text, /Rana Flowers/u);
  assert.match(text, /يُحدَّد عند التواصل/u);
  assert.doesNotMatch(text, /Business/u);
});

test('a message with no owner name still reads politely', () => {
  const text = renewalWhatsAppText({
    kind: 'subscription',
    name: '   ',
    planName: null,
    priceLabel: '0',
    dueDate: null,
    siteName: 'Matjary',
  });
  assert.match(text, /عميلنا العزيز/u);
  assert.match(text, /الحالية/u);
  assert.match(text, /قريباً/u);
});

test('WhatsApp links carry the international digits and encoded text', () => {
  assert.equal(whatsAppDigits('+961 3 123 456'), '9613123456');
  assert.equal(whatsAppDigits(null), null);
  assert.equal(whatsAppDigits('123'), null);
  const link = whatsAppLink('+961 3 123 456', 'مرحباً\nRenew $5');
  assert.ok(link);
  assert.match(link!, /^https:\/\/wa\.me\/9613123456\?text=/u);
  assert.match(link!, /%D9%85%D8%B1%D8%AD%D8%A8/u);
  assert.equal(whatsAppLink('', 'hello'), null);
});
