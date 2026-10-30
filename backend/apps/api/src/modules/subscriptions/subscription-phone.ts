import { normalizeLebanesePhone } from '../verification/verification-phone';

// Lebanon is the default because most owners are local, but a plan can be
// assigned to anyone: the administrator may pick another country or type a
// complete number with its country code. Every accepted value is stored in the
// same +<country><number> form so the admin workspace can dial it directly.
const LEBANESE_DIAL_CODE = '+961';

export function normalizeSubscriptionPhone(
  value: string,
  dialCode = LEBANESE_DIAL_CODE,
): string | null {
  if (typeof value !== 'string') return null;
  const compact = value.trim().replace(/[\s\-().]/gu, '');
  if (!/^\+?\d{7,16}$/u.test(compact)) return null;
  // A number typed with its country code is complete on its own; the selected
  // country only fills in the code for a national format.
  if (compact.startsWith('+')) return internationalPhone(compact);
  if (compact.startsWith('00'))
    return internationalPhone(`+${compact.slice(2)}`);
  if (!/^\+\d{1,3}$/u.test(dialCode)) return null;
  // Lebanon removes the national trunk zero, so a number already carrying 961
  // is treated as Lebanese whichever country the form had selected.
  if (
    dialCode === LEBANESE_DIAL_CODE ||
    compact.startsWith(LEBANESE_DIAL_CODE.slice(1))
  )
    return normalizeLebanesePhone(compact);
  if (compact.startsWith(dialCode.slice(1)))
    return internationalPhone(`+${compact}`);
  const national = compact.replace(/^0+/u, '');
  if (!/^\d{6,13}$/u.test(national)) return null;
  const number = `${dialCode}${national}`;
  // E.164 allows at most 15 digits after the plus sign.
  return number.length <= 16 ? number : null;
}

function internationalPhone(value: string): string | null {
  if (value.startsWith(LEBANESE_DIAL_CODE))
    return normalizeLebanesePhone(value);
  return /^\+[1-9]\d{6,14}$/u.test(value) ? value : null;
}
