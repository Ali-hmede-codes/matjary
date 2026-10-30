// Contact details shown at the bottom of the Terms and Privacy pages.
// Fill in the real email and phone number here when they are ready; until
// then the contact block falls back to the website settings email and shows a
// "coming soon" note for the phone number. No other file needs to change.
export const LEGAL_CONTACT_EMAIL: string | null = null;
export const LEGAL_CONTACT_PHONE: string | null = null;

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
