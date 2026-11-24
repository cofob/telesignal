import rootScope from '@lib/rootScope';
import confirmationPopup from '@components/confirmationPopup';
import {toastNew} from '@components/toast';
import {bindManagersToSession} from '@lib/accounts/bindManagersToAccount';
import {getManagersSession, isSessionLeaving} from '@lib/accounts/getCurrentAccount';
import noop from '@helpers/noop';

/**
 * Logging out unlinks this device from the Signal account and removes its data, as the A version's sign-out does
 * (`SignOutDialog`); the confirmation is the same one. The worker of the account does it in order
 * (`ApiManager.logOut`), and the page starts again on the link screen once it is done (`logging_out`).
 */
export default function showLogOutPopup() {
  const managers = bindManagersToSession(rootScope.managers);
  confirmationPopup({
    titleLangKey: 'LogOutTitle',
    descriptionLangKey: 'SureLogout',
    button: {
      langKey: 'AccountSettingsLogout',
      isDanger: true
    }
  }).then(async() => {
    // * the account switched while the confirmation was open: this account's log out is not carried over
    if(isSessionLeaving(getManagersSession(managers))) return;

    // * the data could not be removed: the account stays, and the log out can be tried again
    await managers.apiManager.logOut().catch(() => toastNew({langPackKey: 'Error.AnError'}));
  }, noop);
}
