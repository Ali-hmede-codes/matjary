// Owners must supply a reachable Lebanese number for verification. The admin
// queue calls it directly, so the value is stored normalized as +961XXXXXXXX.
const COUNTRY_CODE = '+961';

export function normalizeLebanesePhone(value: string): string | null {
  if (typeof value !== 'string') return null;
  const compact = value.trim().replace(/[\s\-().]/gu, '');
  if (!/^\+?\d{7,16}$/u.test(compact)) return null;
  let digits = compact;
  let international = false;
  if (digits.startsWith(`${COUNTRY_CODE}`)) {
    digits = digits.slice(COUNTRY_CODE.length);
    international = true;
  } else if (digits.startsWith('00961')) {
    digits = digits.slice(5);
    international = true;
  } else if (digits.startsWith('961') && digits.length > 9) {
    digits = digits.slice(3);
    international = true;
  }
  // The national trunk prefix (03 123 456) is not part of the stored number.
  if (international) digits = digits.replace(/^0+/u, '');
  else if (digits.startsWith('0')) digits = digits.slice(1);
  if (!/^[1-9]\d{6,7}$/u.test(digits)) return null;
  return `${COUNTRY_CODE}${digits}`;
}
