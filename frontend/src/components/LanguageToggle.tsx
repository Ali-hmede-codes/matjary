import { Languages } from 'lucide-react';
import { useLanguage } from '../hooks/useLanguage';
import { switchLanguage } from '../lib/language';

// The button is named after the language it switches to, so its own label is
// written in that language. `notranslate` keeps the widget from translating the
// one piece of text that has to stay bilingual for the switch to make sense.
export function LanguageToggle() {
  const language = useLanguage();
  const next = language === 'ar' ? 'en' : 'ar';
  return (
    <button
      type="button"
      className="lang-toggle notranslate"
      lang={next}
      dir={next === 'ar' ? 'rtl' : 'ltr'}
      aria-label={
        next === 'ar' ? 'التبديل إلى اللغة العربية' : 'Switch to English'
      }
      onClick={() => switchLanguage(next)}
    >
      <Languages size={16} aria-hidden="true" />
      <span className="lang-toggle-long">
        {next === 'ar' ? 'العربية' : 'English'}
      </span>
      <span className="lang-toggle-short">{next === 'ar' ? 'ع' : 'EN'}</span>
    </button>
  );
}
