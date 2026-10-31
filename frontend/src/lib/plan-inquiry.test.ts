import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SUPPORT_WHATSAPP_DIGITS } from './contact.ts';
import { planInquiryLink, planInquiryText } from './plan-inquiry.ts';

const details = {
  name: '  Jane Doe ',
  email: ' jane@gmail.com ',
  planName: 'Pro',
  priceLabel: '$39.00',
  billingLabel: '/ month',
  siteName: 'Matjary',
};

test('plan inquiry carries the visitor details and the chosen plan', () => {
  assert.equal(
    planInquiryText(details),
    [
      'Hello team,',
      '',
      'I would like to subscribe to the Pro plan ($39.00 / month).',
      '',
      'Name: Jane Doe',
      'Email: jane@gmail.com',
      '',
      '— Matjary',
    ].join('\n'),
  );
});

test('plan inquiry without a plan asks for help choosing', () => {
  assert.equal(
    planInquiryText({ name: 'Jane', email: 'jane@gmail.com' }),
    [
      'Hello team,',
      '',
      'I would like help choosing a plan.',
      '',
      'Name: Jane',
      'Email: jane@gmail.com',
    ].join('\n'),
  );
});

test('plan inquiry opens the global WhatsApp number with the encoded message', () => {
  const link = planInquiryLink(details);
  assert.ok(link.startsWith(`https://wa.me/${SUPPORT_WHATSAPP_DIGITS}?text=`));
  assert.equal(
    decodeURIComponent(link.split('?text=')[1] ?? ''),
    planInquiryText(details),
  );
});
