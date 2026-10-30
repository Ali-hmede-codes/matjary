import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SUPPORT_EMAIL,
  SUPPORT_PHONE,
  SUPPORT_WHATSAPP_DIGITS,
  SUPPORT_WHATSAPP_URL,
} from './contact.ts';

test('support contact details stay reachable and agree with each other', () => {
  assert.match(SUPPORT_EMAIL, /^[^\s@]+@[^\s@]+\.[^\s@]+$/u);
  assert.match(SUPPORT_WHATSAPP_DIGITS, /^\d{7,15}$/u);
  // A wa.me link drops the leading plus and every separator, so the digits
  // must still be the full number shown for calls.
  assert.equal(SUPPORT_PHONE.replace(/\D/gu, ''), SUPPORT_WHATSAPP_DIGITS);
  assert.equal(
    SUPPORT_WHATSAPP_URL,
    `https://wa.me/${SUPPORT_WHATSAPP_DIGITS}`,
  );
});
