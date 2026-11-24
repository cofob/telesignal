/*
 * TeleSignal: why the server stopped accepting this device (the phone unlinked it, or the number was registered
 * elsewhere), which the link screen tells as Web A's `updateDeviceDeauthorized` toast does. The slot logs out and the
 * page reloads in between, so the page keeps the reason in its session storage until the link screen shows it.
 */

import type {LangPackKey} from '@lib/langPack';

export type SignalDeauthorizationReason = 'unlinked' | 'deregistered';

const STORAGE_KEY = 'signal_deauthorized';

export const DEAUTHORIZATION_LANG_KEYS: Record<SignalDeauthorizationReason, LangPackKey> = {
  unlinked: 'SignalDeviceUnlinked',
  deregistered: 'SignalDeviceDeregistered'
};

export function rememberDeauthorization(reason: SignalDeauthorizationReason) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, reason);
  } catch{}
}

/** The reason that the page kept, which is told once */
export function takeDeauthorizationReason(): SignalDeauthorizationReason | undefined {
  try {
    const reason = window.sessionStorage.getItem(STORAGE_KEY) as SignalDeauthorizationReason;
    window.sessionStorage.removeItem(STORAGE_KEY);
    return DEAUTHORIZATION_LANG_KEYS[reason] ? reason : undefined;
  } catch{
    return undefined;
  }
}
