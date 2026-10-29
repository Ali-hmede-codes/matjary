import { useSyncExternalStore } from 'react';
import {
  documentLanguage,
  subscribeLanguage,
  type Language,
} from '../lib/language';

// The document element is the single source of truth: applyLanguage() writes
// lang/dir there, so a reload, a toggle or a restored session all report the
// same value without a second copy of the state.
export function useLanguage(): Language {
  return useSyncExternalStore(
    subscribeLanguage,
    documentLanguage,
    () => 'en' as Language,
  );
}
