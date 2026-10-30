import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeSubscriptionPhone } from '../../apps/api/src/modules/subscriptions/subscription-phone';

test('plan assignments accept a Lebanese number in any common format', () => {
  assert.equal(normalizeSubscriptionPhone('03 123 456'), '+9613123456');
  assert.equal(normalizeSubscriptionPhone('03123456'), '+9613123456');
  assert.equal(normalizeSubscriptionPhone('+961 3 123 456'), '+9613123456');
  assert.equal(normalizeSubscriptionPhone('00961 03 123 456'), '+9613123456');
  assert.equal(normalizeSubscriptionPhone('81 234 567'), '+96181234567');
});

test('plan assignments accept numbers for every other country', () => {
  // A selected country fills in the code for a national number.
  assert.equal(
    normalizeSubscriptionPhone('050 123 4567', '+971'),
    '+971501234567',
  );
  assert.equal(
    normalizeSubscriptionPhone('971501234567', '+971'),
    '+971501234567',
  );
  // A complete number is authoritative even when another country is selected.
  assert.equal(
    normalizeSubscriptionPhone('+963 11 234 5678', '+961'),
    '+963112345678',
  );
  assert.equal(
    normalizeSubscriptionPhone('00963 11 234 5678', '+961'),
    '+963112345678',
  );
});

test('plan assignments reject numbers that cannot be dialed', () => {
  assert.equal(normalizeSubscriptionPhone('', '+961'), null);
  assert.equal(normalizeSubscriptionPhone('12345', '+961'), null);
  assert.equal(normalizeSubscriptionPhone('call me', '+961'), null);
  assert.equal(normalizeSubscriptionPhone('+0123456789', '+961'), null);
  // A dial code the form invents is never trusted.
  assert.equal(normalizeSubscriptionPhone('0501234567', '971'), null);
  // E.164 caps a number at 15 digits after the plus sign.
  assert.equal(normalizeSubscriptionPhone('+9715555555555555', '+971'), null);
});
