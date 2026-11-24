/*
 * TeleSignal: why the server stopped accepting this device (the phone unlinked it, or the number was registered
 * elsewhere), which the link screen tells as Web A's `updateDeviceDeauthorized` toast does. The slot logs out and the
 * page reloads in between, so the page keeps the reason in its session storage, with the account it belongs to,
 * until the link screen of that account shows it or the account opens signed in again.
 */

import type {LangPackKey} from '@lib/langPack';
import {getCurrentAccount} from '@lib/accounts/getCurrentAccount';

export type SignalDeauthorizationReason = 'unlinked' | 'deregistered';

type StoredDeauthorization = {reason: SignalDeauthorizationReason, accountNumber: number};

const STORAGE_KEY = 'signal_deauthorized';

export const DEAUTHORIZATION_LANG_KEYS: Record<SignalDeauthorizationReason, LangPackKey> = {
  unlinked: 'SignalDeviceUnlinked',
  deregistered: 'SignalDeviceDeregistered'
};

/** Keeps the reason for the account of this tab, which the event came from */
export function rememberDeauthorization(reason: SignalDeauthorizationReason) {
  const stored: StoredDeauthorization = {reason, accountNumber: getCurrentAccount()};
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch{}
}

/** The reason kept for the account of this tab, which is told once */
export function takeDeauthorizationReason(): SignalDeauthorizationReason | undefined {
  const stored = readStored();
  if(!stored) return undefined;
  forgetDeauthorization();
  return DEAUTHORIZATION_LANG_KEYS[stored.reason] ? stored.reason : undefined;
}

/** Drops the reason of the account of this tab, which opened signed in again */
export function forgetDeauthorization() {
  if(!readStored()) return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch{}
}

function readStored(): StoredDeauthorization | undefined {
  try {
    const stored: StoredDeauthorization = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY));
    return stored?.accountNumber === getCurrentAccount() ? stored : undefined;
  } catch{
    return undefined;
  }
}
