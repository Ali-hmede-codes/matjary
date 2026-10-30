import assert from 'node:assert/strict';
import { test } from 'node:test';
import { brandDocument, type LegalDocument } from './legal.ts';

const document: LegalDocument = {
  slug: 'terms',
  eyebrow: 'The fine print',
  title: 'Terms of service',
  description: 'The rules for using Matjary.',
  lede: 'Matjary is a showcase platform.',
  sections: [
    {
      id: 'accounts',
      heading: 'Accounts',
      blocks: [
        { kind: 'text', text: 'You agree to use Matjary fairly.' },
        {
          kind: 'list',
          items: ['Matjary may update these rules.', 'matjary_session stays.'],
        },
      ],
    },
  ],
};

test('legal copy follows the live website name without touching cookie names', () => {
  const branded = brandDocument(document, 'Fresh brand');
  assert.equal(branded.description, 'The rules for using Fresh brand.');
  assert.equal(branded.lede, 'Fresh brand is a showcase platform.');
  assert.equal(branded.sections[0]?.blocks[0]?.kind, 'text');
  assert.deepEqual(branded.sections[0]?.blocks[1], {
    kind: 'list',
    items: ['Fresh brand may update these rules.', 'matjary_session stays.'],
  });
  // The source document is never mutated.
  assert.equal(document.lede, 'Matjary is a showcase platform.');
  // An empty name keeps the written copy instead of blanking it.
  assert.equal(brandDocument(document, '  '), document);
});
