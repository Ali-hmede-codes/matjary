// Arabic mode backed by Google's Website Translator.
//
// Every string in this app is written inline in the component that renders it,
// so there is no dictionary to translate. Instead the widget rewrites the text
// nodes of the live document, and this module owns the parts the widget cannot
// do on its own: remembering the choice, setting <html lang/dir> before the
// first paint, and re-driving the widget when a route renders new English text.
// Layout mirroring comes from CSS (logical properties in the component sheets
// plus styles/translated.css), so the English layout is untouched.
//
// Owner-written content — shop names, product names and descriptions, post
// copy, categories, branches, cart lines — is data, not interface copy. Every
// node that renders it carries the `notranslate` class, which the widget (and
// the browser's own translation) skips, so a shop keeps its exact wording in
// Arabic mode while the surrounding labels still translate.
export type Language = 'en' | 'ar';

const LANGUAGE_KEY = 'matjary:language';
const WIDGET_ID = 'matjary-translate-widget';
// The widget reads this cookie when element.js starts: `/en/ar` translates
// English pages into Arabic, `/en/en` is its "show the original" pair.
const GOOGTRANS_COOKIE = 'googtrans';
// element.js is a third-party script, so the language select may appear well
// after the promise resolves on a slow connection.
const COMBO_POLL_INTERVAL_MS = 150;
const COMBO_POLL_ATTEMPTS = 100;
// The widget rewrites the page asynchronously after it is driven; its own DOM
// writes must not schedule another pass, or the two would ping-pong forever.
const WIDGET_SETTLE_MS = 2_500;
// React data queries render a screen in several passes; coalesce them so one
// screen is translated once instead of once per commit.
const RETRANSLATE_DELAY_MS = 600;
// The widget swaps the page in after it is driven. The wordmark is put back
// before the settle window closes, so that rewrite is not read as new content.
const BRAND_RESTORE_DELAY_MS = 1_500;

type LanguageListener = (language: Language) => void;

const listeners = new Set<LanguageListener>();

export function storedLanguage(): Language {
  try {
    // Only the remembered value decides. The cookie is rewritten on every boot,
    // so clearing storage can never leave the widget translating on its own.
    return window.localStorage.getItem(LANGUAGE_KEY) === 'ar' ? 'ar' : 'en';
  } catch {
    // Blocked storage (private windows, embedded webviews) falls back to the
    // source language instead of throwing before the first render.
    return 'en';
  }
}

export function documentLanguage(): Language {
  return document.documentElement.lang === 'ar' ? 'ar' : 'en';
}

function writeTranslateCookie(language: Language): void {
  const pair = language === 'ar' ? '/en/ar' : '/en/en';
  document.cookie = `${GOOGTRANS_COOKIE}=${pair}; path=/; max-age=31536000; samesite=lax`;
}

export function applyLanguage(language: Language): void {
  const root = document.documentElement;
  root.lang = language;
  // `dir` is what the logical CSS properties and the widget's own RTL mode key
  // off, and it has to be in place before the first paint to avoid an LTR flash.
  root.dir = language === 'ar' ? 'rtl' : 'ltr';
  try {
    window.localStorage.setItem(LANGUAGE_KEY, language);
  } catch {
    /* The session still works; only the preference is forgotten. */
  }
  writeTranslateCookie(language);
  for (const listener of listeners) listener(language);
}

export function subscribeLanguage(listener: LanguageListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function switchLanguage(language: Language): void {
  if (language === documentLanguage()) return;
  applyLanguage(language);
  // The widget replaces text nodes in place, so the English copy is gone from
  // the DOM once a page has been translated. A reload starts a fresh document,
  // lets the widget read the new cookie from its first byte, and leaves React
  // owning the nodes it actually created.
  window.location.reload();
}

interface TranslateOptions {
  pageLanguage: string;
  includedLanguages: string;
  autoDisplay: boolean;
}

interface TranslateApi {
  translate: {
    TranslateElement: new (options: TranslateOptions, id: string) => unknown;
  };
}

// Google Identity Services already declares window.google with the accounts
// shape used by the sign-in page. These casts stay local instead of widening
// that global declaration to an incompatible type.
type TranslateWindow = Window & {
  google?: TranslateApi;
  googleTranslateElementInit?: () => void;
};

let widget: Promise<void> | null = null;

function ensureWidget(): Promise<void> {
  if (widget) return widget;
  widget = new Promise<void>((resolve, reject) => {
    const scope = window as TranslateWindow;
    const host = document.createElement('div');
    host.id = WIDGET_ID;
    // Kept off-screen rather than hidden: the widget builds its language select
    // from a laid-out element and leaves it unpopulated under display:none.
    host.className = 'notranslate translate-widget';
    document.body.append(host);
    scope.googleTranslateElementInit = () => {
      const api = scope.google;
      if (!api?.translate) {
        reject(new Error('translate widget unavailable'));
        return;
      }
      new api.translate.TranslateElement(
        { pageLanguage: 'en', includedLanguages: 'en,ar', autoDisplay: false },
        WIDGET_ID,
      );
      resolve();
    };
    const script = document.createElement('script');
    script.src =
      'https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit';
    script.async = true;
    script.onerror = () => reject(new Error('translate widget blocked'));
    document.head.append(script);
  });
  // A blocked script must not poison the next attempt after a route change.
  void widget.catch(() => {
    widget = null;
  });
  return widget;
}

function findCombo(): HTMLSelectElement | null {
  return document.querySelector<HTMLSelectElement>('select.goog-te-combo');
}

async function waitForCombo(): Promise<HTMLSelectElement | null> {
  for (let attempt = 0; attempt < COMBO_POLL_ATTEMPTS; attempt += 1) {
    const combo = findCombo();
    if (combo) return combo;
    await new Promise((resolve) =>
      window.setTimeout(resolve, COMBO_POLL_INTERVAL_MS),
    );
  }
  return null;
}

let lastDrive = 0;
let driving = false;

// A brand name is not translated copy, but the widget transliterates it into
// Arabic script. The spellings it has produced are rewritten after every pass;
// a new one only needs an entry here. The live name comes from the website
// settings so a renamed site is never restored to the build-time brand.
let brandName = 'Matjary';
const BRAND_TRANSLITERATIONS = ['ماتجاري'];

export function setBrandName(value: string): void {
  const trimmed = value.trim();
  if (trimmed) brandName = trimmed;
}

function replaceBrandTransliterations(value: string): string {
  let next = value;
  for (const transliteration of BRAND_TRANSLITERATIONS)
    next = next.split(transliteration).join(brandName);
  return next;
}

function restoreBrandName(): void {
  // The widget translates <head><title> too, and that text is not reached by
  // the body walk below.
  const title = replaceBrandTransliterations(document.title);
  if (title !== document.title) document.title = title;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!(node instanceof Text)) continue;
    const restored = replaceBrandTransliterations(node.data);
    if (restored !== node.data) node.data = restored;
  }
}

export async function requestTranslation(): Promise<void> {
  if (documentLanguage() !== 'ar' || driving) return;
  driving = true;
  try {
    await ensureWidget();
    const combo = await waitForCombo();
    if (!combo) return;
    if (combo.value !== 'ar') combo.value = 'ar';
    // A previous pass may have left the brand transliterated before the page
    // added new text, so it is restored before the next pass starts.
    restoreBrandName();
    lastDrive = Date.now();
    // The select is the widget's public switch: its change handler is what
    // actually walks the document and swaps in translations.
    combo.dispatchEvent(new Event('change'));
    window.setTimeout(restoreBrandName, BRAND_RESTORE_DELAY_MS);
    watchContent();
  } catch {
    // Offline or a blocked script: the English copy stays readable and the
    // layout is still mirrored, so the language button is not a dead end.
  } finally {
    driving = false;
  }
}

let observer: MutationObserver | null = null;
let retranslateTimer: number | null = null;

function watchContent(): void {
  if (observer) return;
  observer = new MutationObserver((records) => {
    if (documentLanguage() !== 'ar') return;
    if (Date.now() - lastDrive < WIDGET_SETTLE_MS) return;
    if (!records.some(isContentRecord)) return;
    if (retranslateTimer !== null) window.clearTimeout(retranslateTimer);
    retranslateTimer = window.setTimeout(() => {
      retranslateTimer = null;
      void requestTranslation();
    }, RETRANSLATE_DELAY_MS);
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}

// The widget's own nodes are skipped so its output never looks like content.
function isContentRecord(record: MutationRecord): boolean {
  const target = record.target;
  if (target instanceof Element)
    return !target.closest(
      '.skiptranslate, #goog-gt-tt, #matjary-translate-widget',
    );
  return !target.parentElement?.closest(
    '.skiptranslate, #goog-gt-tt, #matjary-translate-widget',
  );
}
