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
// * the keys of Web A's `keyCombos.ts`
const MODIFIER_EVENT_KEYS = new Set(['Control', 'Alt', 'AltGraph', 'Shift', 'Meta', 'OS', 'Fn', 'CapsLock']);
const NAMED_KEYS = new Set([
  'Enter', 'Escape', 'Backspace', 'Delete', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Home', 'End', 'PageUp', 'PageDown'
]);
const KEY_BY_CODE: Record<string, string> = {
  Space: 'Space',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: '\'',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Minus: '-',
  Equal: '=',
  Backquote: '`'
};
const PUNCTUATION_KEYS = new Set(Object.values(KEY_BY_CODE));
const RE_LATIN_LETTER = /^[a-z]$/i;
const RE_FUNCTION_KEY = /^F([1-9]|1[0-2])$/;
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
export function normalizeCombo(combo: string) {
  const parts = combo.split('+');
  const key = parts.pop();
  const modifiers = parts.map((part) => part === 'Mod' ? MOD_MODIFIER : part);
  return buildCombo(MODIFIERS.filter((modifier) => modifiers.includes(modifier)), key.length === 1 ? key.toLowerCase() : key);
}

/**
 * The keys of an event as Web A reads them (`getKeyComboFromEvent` in `src/util/keyboardShortcuts/keyCombos.ts`): a
 * letter in lower case, a digit and punctuation unshifted by their place on the keyboard, a named key by its name; the
 * keys that AltGr types are text, not a shortcut
 */
export function getEventCombo(event: KeyboardEvent) {
  const isAltGraph = !IS_APPLE && event.getModifierState('AltGraph');
  if(MODIFIER_EVENT_KEYS.has(event.key)) return;
  if(isAltGraph && !NAMED_KEYS.has(event.key) && !RE_FUNCTION_KEY.test(event.key) && !RE_LATIN_LETTER.test(event.key)) {
    return;
  }

  const key = getEventKey(event);
  if(!key) return;

  const modifiers = MODIFIERS.filter((modifier) => (
    (modifier === 'Ctrl' && (event.ctrlKey || isAltGraph)) ||
    (modifier === 'Alt' && (event.altKey || isAltGraph)) ||
    (modifier === 'Shift' && event.shiftKey) ||
    (modifier === 'Meta' && event.metaKey)
  ));
  return buildCombo(modifiers, key);
}

function getEventKey({code, key}: KeyboardEvent) {
  if(RE_LATIN_LETTER.test(key)) return key.toLowerCase();
  if(code.startsWith('Digit')) return code.slice(5);
  if(PUNCTUATION_KEYS.has(key)) return key;
  if(code.startsWith('Key')) return code.slice(3).toLowerCase();
  if(KEY_BY_CODE[code]) return KEY_BY_CODE[code];
  if(NAMED_KEYS.has(key) || RE_FUNCTION_KEY.test(key)) return key;
}

function buildCombo(modifiers: readonly string[], key: string) {
  return [...modifiers, key].join('+');
}
