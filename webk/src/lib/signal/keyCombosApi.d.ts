/*
 * TeleSignal: Web A's reading and writing of key combos (`src/util/keyboardShortcuts/keyCombos.ts`), which Web K takes
 * as it is (`@signal-app/key-combos`); `src/api/signal/webkContract.ts` checks this description against it
 */

export type KeyComboModifier = 'Ctrl' | 'Alt' | 'Shift' | 'Meta';

export type KeyLabelLangKey = 'KeyboardKeySpace' | 'KeyboardKeyEnter' | 'KeyboardKeyEsc' | 'KeyboardKeyBackspace' |
  'KeyboardKeyDelete' | 'KeyboardKeyTab';

/** A translation function, of which the labels of keys read their names */
export type KeyLabelLang = (key: KeyLabelLangKey) => string;

export const IS_APPLE_KEYBOARD: boolean;
export const MOD_MODIFIER: KeyComboModifier;

/** The keys of an event as a combo (`Ctrl+Shift+k`), or `undefined` for a modifier alone or a character AltGr types */
export function getKeyComboFromEvent(e: KeyboardEvent): string | undefined;
export function getEventModifiers(e: KeyboardEvent): KeyComboModifier[];
/** A combo as the registry writes it (`Mod+K`) in the form that events give (`Ctrl+k` or `Meta+k`) */
export function normalizeKeyCombo(combo: string): string;
export function parseKeyCombo(combo: string): {modifiers: KeyComboModifier[], key: string};
export function getKeyComboLabels(combo: string, lang: KeyLabelLang): string[];
export function getKeyComboText(combo: string, lang: KeyLabelLang): string;
export function getModifierLabels(modifiers: (KeyComboModifier | 'Mod')[]): string[];
export function getKeyLabel(key: string, lang: KeyLabelLang): string;
export function getIsFunctionKey(key: string): boolean;
