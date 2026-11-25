import {bindActiveWindowListener} from '@helpers/appWindow';
import {getIsKeyboardShortcut, listenKeyboardShortcuts} from '@lib/keyboardShortcuts';
import {isSignalPasscodeEnabled} from '@lib/signal/frontend';
import {lockSignalPasscode} from '@lib/signal/passcode';

/**
 * TeleSignal: the shortcut that locks the passcode of Web A's vault, as the lock button of the sidebar does, with Web A's
 * combos and its user's change of them (`lockScreen`, `lib/keyboardShortcuts`). Without a passcode the browser keeps its
 * own use of the keys
 */
export default function useLockScreenShortcut() {
  listenKeyboardShortcuts();
  bindActiveWindowListener((w) => w.document, 'keydown', (event: KeyboardEvent) => {
    if(!isSignalPasscodeEnabled() || !getIsKeyboardShortcut(event, 'lockScreen')) return;

    event.preventDefault();
    lockSignalPasscode();
  });
}
