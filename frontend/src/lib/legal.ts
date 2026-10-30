// Contact details shown at the bottom of the Terms and Privacy pages. They
// come from the platform-wide support identity in contact.ts, so the pages
// that invite visitors to reach the team always agree with each other.
import { SUPPORT_EMAIL, SUPPORT_PHONE } from './contact.ts';

export const LEGAL_CONTACT_EMAIL: string | null = SUPPORT_EMAIL;
export const LEGAL_CONTACT_PHONE: string | null = SUPPORT_PHONE;

// The date the legal copy below was last reviewed. Update both pages together
// whenever their wording changes.
export const LEGAL_LAST_UPDATED = 'October 29, 2026';

export type LegalBlock =
  { kind: 'text'; text: string } | { kind: 'list'; items: string[] };

export interface LegalSection {
  // Anchor used by the table of contents and the section id.
  id: string;
  heading: string;
  blocks: LegalBlock[];
}

export interface LegalDocument {
  slug: 'terms' | 'privacy';
  eyebrow: string;
  title: string;
  // Used for the meta description when the page opens.
  description: string;
  lede: string;
  sections: LegalSection[];
}

export function telHref(phone: string): string {
  // Keep a leading plus sign, drop spaces and punctuation so phone links work
  // on mobile dialers.
  return `tel:${phone.replace(/(?!^\+)[^\d]/gu, '')}`;
}

/**
 * The legal copy is written once with the original brand name. Render it with
 * the administrator's current website name so the pages never contradict the
 * header after a rename. Cookie names stay lower-case and are not affected.
 */
export function brandDocument(
  doc: LegalDocument,
  siteName: string,
): LegalDocument {
  const name = siteName.trim();
  if (!name) return doc;
  const replace = (value: string) => value.split('Matjary').join(name);
  return {
    ...doc,
    eyebrow: replace(doc.eyebrow),
    title: replace(doc.title),
    description: replace(doc.description),
    lede: replace(doc.lede),
    sections: doc.sections.map((section) => ({
      ...section,
      heading: replace(section.heading),
      blocks: section.blocks.map((block) =>
        block.kind === 'text'
          ? { kind: 'text', text: replace(block.text) }
          : { kind: 'list', items: block.items.map(replace) },
      ),
    })),
  };
}
