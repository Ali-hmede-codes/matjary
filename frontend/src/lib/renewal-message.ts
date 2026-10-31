// Manual renewal messages are sent from the administrator's own WhatsApp, so
// the team can adjust the wording before opening the chat. The default is
// Arabic because the owners are Arabic-speaking; the details always come from
// the live renewal row, never from free text.
export type RenewalMessageKind = 'subscription' | 'verification';

export interface RenewalMessageInput {
  kind: RenewalMessageKind;
  // The owner's display name.
  name: string | null | undefined;
  planName?: string | null;
  storeName?: string | null;
  // Already formatted for display (for example "$5.00"). Empty means the price
  // is arranged with the team.
  priceLabel?: string | null;
  // ISO timestamp of the current end date.
  dueDate: string | null;
  siteName?: string | null;
}

const UNKNOWN_PRICE = 'يُحدَّد عند التواصل';

function arabicDate(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('ar-LB', { dateStyle: 'medium' }).format(date);
}

export function renewalWhatsAppText(input: RenewalMessageInput): string {
  const name = input.name?.trim() || 'عميلنا العزيز';
  const date = arabicDate(input.dueDate);
  const price = input.priceLabel?.trim() || UNKNOWN_PRICE;
  const subject =
    input.kind === 'subscription'
      ? `اشتراكك في خطة «${input.planName?.trim() || 'الحالية'}»`
      : `شارة التوثيق لمتجر «${input.storeName?.trim() || 'متجرك'}»`;
  const lines = [
    `مرحباً ${name}،`,
    `نود تذكيرك بأن ${subject} ينتهي بتاريخ${date ? ` ${date}` : ' قريباً'}.`,
    `قيمة التجديد لشهر واحد: ${price}.`,
    'يرجى التواصل معنا لتأكيد الدفع وتجديد الاشتراك.',
  ];
  if (input.siteName?.trim()) lines.push(`— ${input.siteName.trim()}`);
  return lines.join('\n');
}

// wa.me accepts only the international number without punctuation. A number
// that is too short or too long is treated as missing rather than opening a
// chat with the wrong person.
export function whatsAppDigits(
  phone: string | null | undefined,
): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/gu, '');
  return digits.length >= 7 && digits.length <= 15 ? digits : null;
}

export function whatsAppLink(
  phone: string | null | undefined,
  text: string,
): string | null {
  const digits = whatsAppDigits(phone);
  return digits
    ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}`
    : null;
}
