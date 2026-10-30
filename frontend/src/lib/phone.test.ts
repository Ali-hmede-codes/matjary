import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dialCodeFor, phoneDraft } from './phone.ts';

test('stored contact numbers split back into country and national parts', () => {
  assert.deepEqual(phoneDraft('+9613123456'), {
    country: 'LB',
    number: '3123456',
  });
  assert.deepEqual(phoneDraft('+971501234567'), {
    country: 'AE',
    number: '501234567',
  });
  // +1 is shared by Canada and the United States; the first match wins.
  assert.deepEqual(phoneDraft('+14165550123'), {
    country: 'CA',
    number: '4165550123',
  });
  assert.deepEqual(phoneDraft(''), { country: 'LB', number: '' });
  assert.deepEqual(phoneDraft(null), { country: 'LB', number: '' });
});

test('every country choice maps to the dial code sent with the assignment', () => {
  assert.equal(dialCodeFor('LB'), '+961');
  assert.equal(dialCodeFor('AE'), '+971');
  // An unknown choice falls back to Lebanon instead of an unsafe prefix.
  assert.equal(dialCodeFor('XX'), '+961');
});
