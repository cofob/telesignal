import rootScope from '@lib/rootScope';
import appNavigationController from '@components/appNavigationController';
import confirmationPopup from '@components/confirmationPopup';
import {bindManagersToSession} from '@lib/accounts/bindManagersToAccount';
import {getManagersSession, isSessionLeaving} from '@lib/accounts/getCurrentAccount';
import sessionStorage from '@lib/sessionStorage';
import noop from '@helpers/noop';
import pause from '@helpers/schedulers/pause';
import clearSignalLocalData from '@signal-app/clear-local-data';

// * how long each step of a log out is waited for, as Web A's sign-out waits for the engine (`signOut`)
const LOG_OUT_WAIT_MS = 3000;

/**
 * Logging out unlinks this device from the Signal account and removes its data, as the A version's sign-out does
 * (`SignOutDialog`); the confirmation is the same one. The engine forgets the account first, the page clears what the
 * engine did not, and the page starts again on the link screen.
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

    await Promise.race([managers.apiManager.logOut(), pause(LOG_OUT_WAIT_MS)]).catch(noop);
    await Promise.race([clearSignalLocalData(), pause(LOG_OUT_WAIT_MS)]).catch(noop);
    await sessionStorage.delete('account1').catch(noop);
    appNavigationController.reload();
  }, noop);
}
