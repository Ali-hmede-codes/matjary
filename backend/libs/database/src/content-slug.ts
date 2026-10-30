// Shop, product and post addresses stay ASCII: they are pasted into chats,
// indexed by search engines and reused by the SEO share-page/share-shell
// paths, which all assume latin segments. Arabic names are the norm on this
// platform, so the ASCII fold has to transliterate them instead of erasing
// them; otherwise every Arabic name collapses into the same generic address.
const ARABIC_LATIN: Readonly<Record<string, string>> = {
  // Hamza carriers keep only their seat letter.
  ء: '',
  آ: 'a',
  أ: 'a',
  ؤ: 'w',
  إ: 'a',
  ئ: 'y',
  ا: 'a',
  ٱ: 'a',
  // Consonants, spelled the way Levantine merchants write their handles.
  ب: 'b',
  ت: 't',
  ث: 'th',
  ج: 'j',
  ح: 'h',
  خ: 'kh',
  د: 'd',
  ذ: 'dh',
  ر: 'r',
  ز: 'z',
  س: 's',
  ش: 'sh',
  ص: 's',
  ض: 'd',
  ط: 't',
  ظ: 'z',
  ع: 'a',
  غ: 'gh',
  ف: 'f',
  ق: 'q',
  ك: 'k',
  ل: 'l',
  م: 'm',
  ن: 'n',
  ه: 'h',
  و: 'w',
  ى: 'a',
  ي: 'y',
  ة: 'a',
  // Persian/Urdu variants that appear in regional shop names.
  پ: 'p',
  چ: 'ch',
  ژ: 'zh',
  ڤ: 'v',
  ک: 'k',
  گ: 'g',
  ی: 'y',
  ە: 'a',
  // Arabic-Indic and extended Arabic-Indic digits read as the same numbers.
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9',
  '۰': '0',
  '۱': '1',
  '۲': '2',
  '۳': '3',
  '۴': '4',
  '۵': '5',
  '۶': '6',
  '۷': '7',
  '۸': '8',
  '۹': '9',
};

// Latin slug base for a display name: accented latin letters lose their
// accents, Arabic letters are transliterated, marks/tatweel are dropped, and
// every other run of characters becomes a single hyphen. The result can be
// empty (for names without any latin or Arabic letters); callers choose the
// fallback.
export function latinSlugBase(name: string): string {
  const transliterated = Array.from(name.normalize('NFKD'))
    // Harakat and tatweel are decorative: dropping them keeps an Arabic word
    // together instead of turning every vowel mark into a separator.
    .filter((char) => !/[\p{M}\u0640]/u.test(char))
    .map((char) => ARABIC_LATIN[char] ?? char)
    .join('');
  return (
    transliterated
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      // Leave room for the collision suffix inside the 191-character columns.
      .slice(0, 180)
      .replace(/-$/g, '')
  );
}
