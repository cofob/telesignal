/*
 * TeleSignal: the composer's automatic text replacements, as Web A's `RichEditorTextReplacements`
 * (`src/components/middle/composer/helpers/richEditorTextReplacements.ts`), and the setting that turns them on, which
 * both frontends share (`shouldReplaceTextShortcuts` of Web A, on unless it is `false`).
 */

import {createRoot, createSignal} from 'solid-js';
import {readWebASharedSettings, updateWebASharedSettings, type WebASharedSettings} from '@lib/signal/webAState';

export const TEXT_REPLACEMENTS = [
  {find: /--$/, replacement: '—'},
  {find: /<<$/, replacement: '«'},
  {find: />>$/, replacement: '»'},
  {find: /:shrug:$/, replacement: '¯\\_(ツ)_/¯'}
];

const [shouldReplace, setShouldReplace] = createRoot(() => createSignal(true));
let isListening = false;

/** Whether the replacements are on; the first call starts following the setting, which Web A may change */
export function getShouldReplaceTextShortcuts() {
  listenTextReplacementSetting();
  return shouldReplace();
}

export async function setShouldReplaceTextShortcuts(value: boolean) {
  setShouldReplace(value);
  await updateWebASharedSettings({shouldReplaceTextShortcuts: value});
}

// * read now, and again whenever the window comes back, as the keyboard shortcuts are (`lib/keyboardShortcuts.ts`)
function listenTextReplacementSetting() {
  if(isListening) return;
  isListening = true;
  void loadTextReplacementSetting();
  window.addEventListener('focus', () => void loadTextReplacementSetting());
}

async function loadTextReplacementSetting() {
  const settings = await readWebASharedSettings().catch((): WebASharedSettings => ({}));
  setShouldReplace(settings.shouldReplaceTextShortcuts !== false);
}
