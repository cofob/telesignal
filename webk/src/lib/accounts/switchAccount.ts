import {MOUNT_CLASS_TO} from '@config/debug';
import {changeAccount} from '@lib/accounts/changeAccount';
import {getCurrentAccount, setAccountSwitchingTo} from '@lib/accounts/getCurrentAccount';
import {ActiveAccountNumber} from '@lib/accounts/types';
import appImManager from '@lib/appImManager';

MOUNT_CLASS_TO && (MOUNT_CLASS_TO.switchAccount = (accountNumber: ActiveAccountNumber) => switchAccount(accountNumber));

/**
 * TeleSignal: shows another account by reloading the tab into its slot, as Web A does. Each slot's Signal engine runs
 * in a worker of its own (`lib/signal/accountSlot`), so the tab cannot switch its managers to another account in
 * place, the way upstream does for Telegram's accounts.
 */
export default async function switchAccount(accountNumber: ActiveAccountNumber) {
  if(accountNumber === getCurrentAccount()) {
    return;
  }

  // * what waits for the switch (a click on a notification) sees it under way until the tab reloads
  setAccountSwitchingTo(accountNumber);
  appImManager.goOffline();
  changeAccount(accountNumber);
}
