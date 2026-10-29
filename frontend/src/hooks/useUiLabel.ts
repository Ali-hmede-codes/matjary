import { useLanguage } from './useLanguage';
import { uiLabel } from '../lib/ui-labels';

// Returns the curated Arabic wording in Arabic mode and the English source
// otherwise. Components pair it with a `notranslate` element so the widget
// cannot replace a label that was chosen deliberately.
export function useUiLabel(): (english: string) => string {
  const language = useLanguage();
  return (english: string) => uiLabel(language, english);
}
