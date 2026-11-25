/*
 * TeleSignal: what Web A's settings check of a recorded shortcut (`src/components/left/settings/keyboardShortcuts/
 * helpers.ts`): combos the browser or system keep, combos that need a modifier, and shortcuts that would share a combo
 * where they both work. Web K's settings screen asks the same, so a combo is refused or replaced in either frontend
 * alike.
 */

import {
  KEYBOARD_SHORTCUT_IDS,
  KEYBOARD_SHORTCUTS,
  TEXT_EDITING_COMBOS,
  type KeyboardShortcutCondition,
  type KeyboardShortcutId,
  type KeyboardShortcutScope
} from '@signal-app/keyboard-shortcuts';
import {getIsFunctionKey, IS_APPLE_KEYBOARD, normalizeKeyCombo, parseKeyCombo} from '@signal-app/key-combos';
import {getKeyboardShortcutCombos, IS_APP, type ResolvedKeyboardShortcutCombo} from '@lib/keyboardShortcuts';

export type KeyboardShortcutCombos = Record<KeyboardShortcutId, ResolvedKeyboardShortcutCombo[]>;

export type RecordedComboCheck =
  {type: 'ok'} |
  {type: 'needsModifier'} |
  {type: 'reserved'} |
  {type: 'usedByFixed', ownerId: KeyboardShortcutId} |
  {type: 'usedByEditable', ownerIds: KeyboardShortcutId[]};

const MAIN_SCOPES = new Set<KeyboardShortcutScope>(['chatList', 'chat', 'composer', 'messageSelection']);
const EXCLUSIVE_CONDITIONS: [KeyboardShortcutCondition, KeyboardShortcutCondition][] = [
  ['hasSelection', 'noSelection'],
  ['hasSelection', 'isInputEmpty']
];
const COMMAND_MODIFIERS = new Set(['Ctrl', 'Alt', 'Meta']);
const RESERVED_KEYS = new Set(['Enter', 'Tab']);
const RESERVED_KEYS_WITH_MODIFIERS = new Set(['Backspace', 'Delete', 'Escape']);
const SYSTEM_RESERVED_COMBOS = [...TEXT_EDITING_COMBOS, ...(IS_APPLE_KEYBOARD ? ['Meta+Q'] : [])];
const BROWSER_RESERVED_COMBOS = [
  'Mod+N', 'Mod+Shift+N', 'Mod+T', 'Mod+Shift+T', 'Mod+W', 'Mod+Shift+W', 'Ctrl+PageUp', 'Ctrl+PageDown', 'F11',
  ...(IS_APPLE_KEYBOARD ? ['Meta+Alt+ArrowLeft', 'Meta+Alt+ArrowRight', 'Meta+Shift+[', 'Meta+Shift+]'] : ['Ctrl+F4'])
];
// * the browser's own combos are free in an app of its own window
const RESERVED_COMBOS = new Set([
  ...SYSTEM_RESERVED_COMBOS,
  ...(IS_APP ? [] : BROWSER_RESERVED_COMBOS)
].map(normalizeKeyCombo));

export function buildKeyboardShortcutCombos() {
  const result = {} as KeyboardShortcutCombos;
  for(const id of KEYBOARD_SHORTCUT_IDS) result[id] = getKeyboardShortcutCombos(id);
  return result;
}

/** The shortcuts that share a combo with each, where both work and one of them can be changed */
export function buildKeyboardShortcutConflicts(combos: KeyboardShortcutCombos) {
  const conflicts: Partial<Record<KeyboardShortcutId, KeyboardShortcutId[]>> = {};
  for(const id of KEYBOARD_SHORTCUT_IDS) {
    for(const {combo, condition} of combos[id]) {
      const ownerIds = findComboOwners(id, combo, condition, combos);
      if(ownerIds.length) conflicts[id] = [...new Set([...(conflicts[id] ?? []), ...ownerIds])];
    }
  }

  return conflicts;
}

export function checkRecordedCombo(
  id: KeyboardShortcutId,
  {combo, condition}: ResolvedKeyboardShortcutCombo,
  combos: KeyboardShortcutCombos
): RecordedComboCheck {
  const {modifiers, key} = parseKeyCombo(combo);
  const hasCommandModifier = modifiers.some((modifier) => COMMAND_MODIFIERS.has(modifier));
  if(RESERVED_COMBOS.has(combo) || RESERVED_KEYS.has(key) || (modifiers.length && RESERVED_KEYS_WITH_MODIFIERS.has(key))) {
    return {type: 'reserved'};
  }

  if(!hasCommandModifier && !getIsFunctionKey(key)) return {type: 'needsModifier'};

  const ownerIds = findComboOwners(id, combo, condition, combos);
  if(!ownerIds.length) return {type: 'ok'};

  const fixedOwnerId = ownerIds.find((ownerId) => !KEYBOARD_SHORTCUTS[ownerId].isEditable);
  return fixedOwnerId ? {type: 'usedByFixed', ownerId: fixedOwnerId} : {type: 'usedByEditable', ownerIds};
}

/** The editable shortcuts that took a default combo of `id`, which a reset of `id` takes back */
export function findEditableDefaultComboOwners(
  id: KeyboardShortcutId,
  defaultCombos: ResolvedKeyboardShortcutCombo[],
  combos: KeyboardShortcutCombos
) {
  const ownerIds = defaultCombos.flatMap(({combo, condition}) => findComboOwners(id, combo, condition, combos));
  return [...new Set(ownerIds)].filter((ownerId) => KEYBOARD_SHORTCUTS[ownerId].isEditable);
}

function findComboOwners(
  id: KeyboardShortcutId,
  combo: string,
  condition: KeyboardShortcutCondition | undefined,
  combos: KeyboardShortcutCombos
) {
  return KEYBOARD_SHORTCUT_IDS.filter((otherId) => otherId !== id && combos[otherId].some((resolved) => (
    resolved.combo === combo && getIsConflict(id, condition, otherId, resolved.condition)
  )));
}

function getIsConflict(
  id: KeyboardShortcutId,
  condition: KeyboardShortcutCondition | undefined,
  otherId: KeyboardShortcutId,
  otherCondition: KeyboardShortcutCondition | undefined
) {
  const shortcut = KEYBOARD_SHORTCUTS[id];
  const other = KEYBOARD_SHORTCUTS[otherId];
  return !!(shortcut.isEditable || other.isEditable) &&
    getAreScopesOverlapping(shortcut.scope, other.scope) &&
    !getAreConditionsExclusive(condition, otherCondition);
}

function getAreScopesOverlapping(scope: KeyboardShortcutScope, otherScope: KeyboardShortcutScope) {
  if(scope === otherScope || scope === 'global' || otherScope === 'global') return true;
  if(!MAIN_SCOPES.has(scope) || !MAIN_SCOPES.has(otherScope)) return false;

  const scopes = [scope, otherScope];
  return !(scopes.includes('composer') && scopes.includes('messageSelection'));
}

function getAreConditionsExclusive(condition?: KeyboardShortcutCondition, otherCondition?: KeyboardShortcutCondition) {
  if(!condition || !otherCondition) return false;
  return EXCLUSIVE_CONDITIONS.some(([first, second]) => (
    (condition === first && otherCondition === second) || (condition === second && otherCondition === first)
  ));
}
