/*
 * TeleSignal: what a log out of an account slot removes on the page, after the worker removed the engine's data and
 * the slot (`ApiManager.logOut`): Web A's cached global state of the slot, and with a passcode the slot's copies in
 * Web A's vault, which the worker cannot reach.
 */

import AccountController from '@lib/accounts/accountController';
import {ActiveAccountNumber} from '@lib/accounts/types';
import {removeWebAGlobalState} from '@lib/signal/webAState';
import {
  getDekGeneration,
  refreshSessionsVault,
  removeGlobalsVaultForSlot,
  requestPasscodeStateLock
} from '@signal-app/passcode';
import {broadcastPasscodeSessionsChanged} from '@signal-app/passcode-channel';
import {isSessionStoreLocked} from '@signal-app/passcode-session';
import {IS_DESKTOP_APP} from '@lib/signal/desktopApp';
import noop from '@helpers/noop';

export async function clearLoggedOutSlotOnPage(accountNumber: ActiveAccountNumber) {
  // * the slot in this page's session values, which with a passcode are kept in memory: removed and written into the
  // * vault under one lock, as Web A's `updateSessionStorage` does, so that none of the page's tabs writes the slot back
  await requestPasscodeStateLock(async() => {
    if(isSessionStoreLocked()) return;

    await AccountController.remove(accountNumber);
    const generation = getDekGeneration();
    if(!generation) return;

    // * as Web A's `resetStorage` removes the slot's state from the vault
    await removeGlobalsVaultForSlot(accountNumber === 1 ? undefined : accountNumber);
    if(await refreshSessionsVault()) broadcastPasscodeSessionsChanged(generation);
  });

  await removeWebAGlobalState(accountNumber);
  // * as Web A's log out: the desktop app's records of saved files hold their paths and attachment keys
  if(IS_DESKTOP_APP) {
    await import('@lib/signal/desktopFiles').then(({forgetDesktopSavedFiles}) => forgetDesktopSavedFiles()).catch(noop);
  }
}
