export interface PhoneCountry {
  code: string;
  name: string;
  dialCode: string;
}

// Lebanon comes first because most owners are local; the rest covers the usual
// neighbouring markets and the diaspora. A complete number typed with + always
// works, so this list is a convenience, never a limit.
export const PHONE_COUNTRIES: PhoneCountry[] = [
  { code: 'LB', name: 'Lebanon', dialCode: '+961' },
  { code: 'SY', name: 'Syria', dialCode: '+963' },
  { code: 'JO', name: 'Jordan', dialCode: '+962' },
  { code: 'PS', name: 'Palestine', dialCode: '+970' },
  { code: 'IQ', name: 'Iraq', dialCode: '+964' },
  { code: 'EG', name: 'Egypt', dialCode: '+20' },
  { code: 'SA', name: 'Saudi Arabia', dialCode: '+966' },
  { code: 'AE', name: 'United Arab Emirates', dialCode: '+971' },
  { code: 'QA', name: 'Qatar', dialCode: '+974' },
  { code: 'KW', name: 'Kuwait', dialCode: '+965' },
  { code: 'BH', name: 'Bahrain', dialCode: '+973' },
  { code: 'OM', name: 'Oman', dialCode: '+968' },
  { code: 'TR', name: 'Türkiye', dialCode: '+90' },
  { code: 'CY', name: 'Cyprus', dialCode: '+357' },
  { code: 'FR', name: 'France', dialCode: '+33' },
  { code: 'DE', name: 'Germany', dialCode: '+49' },
  { code: 'GB', name: 'United Kingdom', dialCode: '+44' },
  { code: 'CA', name: 'Canada', dialCode: '+1' },
  { code: 'US', name: 'United States', dialCode: '+1' },
  { code: 'AU', name: 'Australia', dialCode: '+61' },
  { code: 'BR', name: 'Brazil', dialCode: '+55' },
];

export function dialCodeFor(code: string): string {
  return (
    PHONE_COUNTRIES.find((country) => country.code === code)?.dialCode ??
    PHONE_COUNTRIES[0]!.dialCode
  );
}

/**
 * Split a stored number back into the form's country choice and the national
 * part, so re-assigning a plan shows the number that is already on record.
 */
export function phoneDraft(stored: string | null | undefined): {
  country: string;
  number: string;
} {
  const compact = (stored ?? '').replace(/[^\d+]/gu, '');
  // The longest matching dial code wins, so +961 is never read as +96.
  const match = PHONE_COUNTRIES.filter((country) =>
    compact.startsWith(country.dialCode),
  ).sort((a, b) => b.dialCode.length - a.dialCode.length)[0];
  if (!match) return { country: 'LB', number: compact };
  return {
    country: match.code,
    number: compact.slice(match.dialCode.length),
  };
}
