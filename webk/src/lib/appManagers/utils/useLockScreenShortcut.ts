import {IS_APPLE} from '@environment/userAgent';
import {bindActiveWindowListener} from '@helpers/appWindow';
import {isSignalPasscodeEnabled} from '@lib/signal/frontend';
import {lockSignalPasscode} from '@lib/signal/passcode';
import {readWebASharedSettings} from '@lib/signal/webAState';

// * Web A's id of the shortcut and its defaults (`lockScreen` in `src/util/keyboardShortcuts/registry.ts`): Ctrl+Shift+L
// * everywhere, Cmd+Shift+L on Apple's systems too, and Mod+L in the installed app
const LOCK_SCREEN_SHORTCUT_ID = 'lockScreen';
const MODIFIERS = ['Ctrl', 'Alt', 'Shift', 'Meta'] as const;
const MOD_MODIFIER = IS_APPLE ? 'Meta' : 'Ctrl';
// * Web A's `IS_APP`: a standalone window or the desktop app
const IS_APP = window.matchMedia('(display-mode: standalone)').matches ||
  !!(navigator as {standalone?: boolean}).standalone ||
  !!(globalThis as {isTauri?: boolean}).isTauri;
const DEFAULT_COMBOS = [
  'Ctrl+Shift+L',
  IS_APPLE && 'Meta+Shift+L',
  IS_APP && 'Mod+L'
].filter(Boolean).map(normalizeCombo);

/** The combos that lock, as Web A resolves them: its user's own one, none, or the defaults */
export async function getLockScreenCombos() {
  const custom = (await readWebASharedSettings().catch((): undefined => undefined))?.keyboardShortcuts?.[LOCK_SCREEN_SHORTCUT_ID];
  if(custom === false) return [];
  return custom ? [normalizeCombo(custom)] : DEFAULT_COMBOS;
}

/**
 * TeleSignal: the shortcut that locks the passcode of Web A's vault, as the lock button of the sidebar does, with Web A's
 * combos and its user's change of them. A combo matches only with exactly its modifiers; without a passcode the browser
 * keeps its own use of the keys
 */
export default function useLockScreenShortcut() {
  let combos = DEFAULT_COMBOS;
  const refresh = () => getLockScreenCombos().then((value) => combos = value);
  refresh();
  // * a change made in Web A is read when the user comes back to this window
  window.addEventListener('focus', refresh);

  bindActiveWindowListener((w) => w.document, 'keydown', (event: KeyboardEvent) => {
    const combo = getEventCombo(event);
    if(!combo || !combos.includes(combo) || !isSignalPasscodeEnabled()) return;

    event.preventDefault();
    lockSignalPasscode();
  });
}

/** The keys as Web A writes them (`normalizeKeyCombo`): the modifiers in a fixed order, a letter in lower case */
function normalizeCombo(combo: string) {
  const parts = combo.split('+');
  const key = parts.pop();
  const modifiers = parts.map((part) => part === 'Mod' ? MOD_MODIFIER : part);
  return buildCombo(MODIFIERS.filter((modifier) => modifiers.includes(modifier)), key.length === 1 ? key.toLowerCase() : key);
}

// * a letter by its place on the keyboard, as Web A reads it (`getKeyFromEvent`), so that other layouts match too
function getEventCombo(event: KeyboardEvent) {
  const key = /^[a-z]$/i.test(event.key) ? event.key.toLowerCase() : (
    event.code.startsWith('Key') ? event.code.slice(3).toLowerCase() : undefined
  );
  if(!key) return;

  const modifiers = MODIFIERS.filter((modifier) => (
    (modifier === 'Ctrl' && event.ctrlKey) ||
    (modifier === 'Alt' && event.altKey) ||
    (modifier === 'Shift' && event.shiftKey) ||
    (modifier === 'Meta' && event.metaKey)
  ));
  return buildCombo(modifiers, key);
}

function buildCombo(modifiers: readonly string[], key: string) {
  return [...modifiers, key].join('+');
}
