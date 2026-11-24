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

export async function clearLoggedOutSlotOnPage(accountNumber: ActiveAccountNumber) {
  // * the session values of this page, which keeps them in memory while the vault is unlocked: removed here too, so that
  // * none of the page's tabs writes the slot back into the vault
  await AccountController.remove(accountNumber);

  await Promise.all([
    removeWebAGlobalState(accountNumber),
    removeSlotFromVault(accountNumber)
  ]);
}

async function removeSlotFromVault(accountNumber: ActiveAccountNumber) {
  const generation = getDekGeneration();
  if(!generation) return;

  // * as Web A's `updateSessionStorage` and `resetStorage` keep the vault up to date
  await requestPasscodeStateLock(async() => {
    await removeGlobalsVaultForSlot(accountNumber === 1 ? undefined : accountNumber);
    if(await refreshSessionsVault()) broadcastPasscodeSessionsChanged(generation);
  });
}
