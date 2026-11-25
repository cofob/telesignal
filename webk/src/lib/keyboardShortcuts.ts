/*
 * TeleSignal: the keyboard shortcuts of Web K, by the ids and defaults of Web A's registry (`@signal-app/keyboard-shortcuts`,
 * `src/util/keyboardShortcuts/registry.ts`), with the user's changes of them from the settings both frontends share
 * (`keyboardShortcuts` of Web A's shared state, `lib/signal/webAState`). A handler asks `getIsKeyboardShortcut` whether an
 * event is a shortcut, as Web A's do (`src/util/keyboardShortcuts/index.ts`); a change made in Web A is read when the
 * user comes back to this window.
 */

import {createSignal} from 'solid-js';
import {
  KEYBOARD_SHORTCUT_IDS,
  KEYBOARD_SHORTCUTS,
  type KeyboardShortcutCondition,
  type KeyboardShortcutDefault,
  type KeyboardShortcutId
} from '@signal-app/keyboard-shortcuts';
import {getKeyComboFromEvent, IS_APPLE_KEYBOARD, normalizeKeyCombo, parseKeyCombo} from '@signal-app/key-combos';
import {IS_WINDOWS} from '@signal-app/platform';
import {IS_FIREFOX} from '@environment/userAgent';
import {IS_DESKTOP_APP} from '@lib/signal/desktopApp';
import {readWebASharedSettings, updateWebASharedSettings} from '@lib/signal/webAState';

export type ResolvedKeyboardShortcutCombo = {combo: string, condition?: KeyboardShortcutCondition};
// * the shortcuts changed from their defaults: a combo, or `false` for none
export type KeyboardShortcutOverrides = Partial<Record<KeyboardShortcutId, string | false>>;
type SendKeyCombo = 'enter' | 'ctrl-enter';

const NO_COMBOS: ResolvedKeyboardShortcutCombo[] = [];
// * Web A's environments of the defaults (`getIsDefaultAvailable`): `IS_APP` is a standalone window or the desktop app
export const IS_APP = IS_DESKTOP_APP || window.matchMedia('(display-mode: standalone)').matches ||
  !!(navigator as {standalone?: boolean}).standalone;
const DEFAULT_COMBOS: Record<SendKeyCombo, Record<KeyboardShortcutId, ResolvedKeyboardShortcutCombo[]>> = {
  'enter': buildDefaultCombos('enter'),
  'ctrl-enter': buildDefaultCombos('ctrl-enter')
};

const [overrides, setOverrides] = createSignal<KeyboardShortcutOverrides>({});
const [sendKeyCombo, setSendKeyCombo] = createSignal<SendKeyCombo>('enter');
let isListening = false;

/** The user's changes of the shortcuts, which the settings screen follows */
export const getKeyboardShortcutOverrides = overrides;

/** The combos of a shortcut: the user's own one, none, or the defaults, as Web A's `getKeyboardShortcutCombos` */
export function getKeyboardShortcutCombos(id: KeyboardShortcutId, custom: KeyboardShortcutOverrides = overrides()) {
  const combo = custom[id];
  if(combo === false) return NO_COMBOS;

  const defaults = getDefaultKeyboardShortcutCombos(id);
  if(!combo) return defaults;

  const normalized = normalizeKeyCombo(combo);
  return [defaults.find((resolved) => resolved.combo === normalized) ?? {
    combo: normalized,
    condition: KEYBOARD_SHORTCUTS[id].condition
  }];
}

export function getDefaultKeyboardShortcutCombos(id: KeyboardShortcutId) {
  return DEFAULT_COMBOS[sendKeyCombo()][id];
}

/** Whether a key event is one of the shortcut's combos; the condition of a combo is the handler's to check */
export function getIsKeyboardShortcut(e: KeyboardEvent, id: KeyboardShortcutId) {
  const combo = getKeyComboFromEvent(e);
  return !!combo && getKeyboardShortcutCombos(id).some((resolved) => resolved.combo === combo);
}

/** Reads the user's changes now, and again whenever the window comes back, where Web A may have changed them */
export function listenKeyboardShortcuts() {
  if(isListening) return;
  isListening = true;
  void loadKeyboardShortcuts();
  window.addEventListener('focus', () => void loadKeyboardShortcuts());
}

/** Sets a shortcut's combo, or none (`false`); one that is its only default is no change, as Web A's `setKeyboardShortcut` */
export function setKeyboardShortcut(id: KeyboardShortcutId, combo: string | false) {
  const defaults = getDefaultKeyboardShortcutCombos(id);
  const isDefault = combo === false ? !defaults.length : defaults.length === 1 && defaults[0].combo === combo;
  const next = {...overrides()};
  if(isDefault) delete next[id];
  else next[id] = combo;
  return saveKeyboardShortcuts(next);
}

/** Puts a shortcut, or with no id all of them, back to the defaults */
export function resetKeyboardShortcuts(id?: KeyboardShortcutId) {
  const next = {...overrides()};
  if(id) delete next[id];
  return saveKeyboardShortcuts(id ? next : {});
}

// * where both frontends read them; Web A's open tabs take them at once (`listenOtherClients` in Web A)
async function saveKeyboardShortcuts(next: KeyboardShortcutOverrides) {
  setOverrides(next);
  await updateWebASharedSettings({keyboardShortcuts: next});
}

async function loadKeyboardShortcuts() {
  const settings = await readWebASharedSettings().catch((): undefined => undefined);
  if(!settings) return;

  setOverrides(parseOverrides(settings.keyboardShortcuts));
  setSendKeyCombo(settings.messageSendKeyCombo === 'ctrl-enter' ? 'ctrl-enter' : 'enter');
}

// * only the ids of the registry, each with a combo that has a key or `false`
function parseOverrides(value: unknown): KeyboardShortcutOverrides {
  if(typeof value !== 'object' || !value) return {};

  const parsed: KeyboardShortcutOverrides = {};
  for(const id of KEYBOARD_SHORTCUT_IDS) {
    const combo = (value as Record<string, unknown>)[id];
    if(combo === false || (typeof combo === 'string' && parseKeyCombo(combo).key)) parsed[id] = combo;
  }

  return parsed;
}

function buildDefaultCombos(sendKey: SendKeyCombo) {
  const result = {} as Record<KeyboardShortcutId, ResolvedKeyboardShortcutCombo[]>;
  for(const id of KEYBOARD_SHORTCUT_IDS) {
    const {defaults, condition} = KEYBOARD_SHORTCUTS[id];
    result[id] = defaults
    .filter((shortcutDefault) => getIsDefaultAvailable(shortcutDefault, sendKey))
    .map((shortcutDefault) => ({
      combo: normalizeKeyCombo(shortcutDefault.combo),
      condition: shortcutDefault.condition ?? condition
    }));
  }

  return result;
}

function getIsDefaultAvailable({platform, environment, sendKeyCombo: sendKey}: KeyboardShortcutDefault, current: SendKeyCombo) {
  if(platform === 'mac' && !IS_APPLE_KEYBOARD) return false;
  if(platform === 'windows' && !IS_WINDOWS) return false;
  if(environment === 'app' && !IS_APP) return false;
  if(environment === 'notMacApp' && IS_APPLE_KEYBOARD && IS_APP) return false;
  if(environment === 'notMacTauri' && (!IS_DESKTOP_APP || IS_APPLE_KEYBOARD)) return false;
  if(environment === 'notFirefox' && IS_FIREFOX) return false;
  if(sendKey && sendKey !== current) return false;

  return true;
}
