import {IS_APPLE} from '@environment/userAgent';
import {addShortcutListener} from '@helpers/shortcutListener';
import {isSignalPasscodeEnabled} from '@lib/signal/frontend';
import {lockSignalPasscode} from '@lib/signal/passcode';

// * Web A's default of `lockScreen` (`src/util/keyboardShortcuts/registry.ts`); `ctrl` shows as ⌘ on Apple's systems
export const LOCK_SCREEN_SHORTCUT_KEYS = ['ctrl', 'shift', 'L'];

/**
 * TeleSignal: the shortcut that locks the passcode of Web A's vault, as the lock button of the sidebar does; it does
 * nothing without a passcode, and the browser keeps its own use of the keys then
 */
export default function useLockScreenShortcut() {
  const combo = (IS_APPLE ? ['meta', 'shift', 'L'] : LOCK_SCREEN_SHORTCUT_KEYS).join('+');
  addShortcutListener([combo], (_, event) => {
    if(!isSignalPasscodeEnabled()) return;

    event.preventDefault();
    lockSignalPasscode();
  }, false);
}
