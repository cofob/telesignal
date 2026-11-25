import showPeerPopup, {PopupPeerButton} from '@components/popups/peer';
import showSafetyNumberPopup from '@components/popups/safetyNumber';
import {toastNew} from '@components/toast';
import getPeerTitle from '@components/wrappers/getPeerTitle';
import rootScope from '@lib/rootScope';
import {bindManagersToSession} from '@lib/accounts/bindManagersToAccount';

/**
 * Recipients whose new safety number kept a message from being sent to them (Web A's `SafetyNumberChangeModal`):
 * the message goes to them anyway (`sendMessageAnyway`), or a safety number is checked first
 */
export default async function showSafetyNumberBlockPopup(messageId: number, userIds: PeerId[]) {
  const managers = bindManagersToSession(rootScope.managers);
  const titles = await Promise.all(userIds.map((userId) => getPeerTitle({peerId: userId, plainText: true})));

  const verifyButtons: PopupPeerButton[] = userIds.map((userId, index) => ({
    langKey: 'Signal.SafetyNumberVerifyUser',
    langArgs: [titles[index]],
    callback: () => void showSafetyNumberPopup(userId)
  }));

  showPeerPopup('popup-safety-number-block', {
    titleLangKey: 'Signal.SafetyNumberChanges',
    descriptionLangKey: 'Signal.SafetyNumberChangesText',
    buttons: [{
      langKey: 'Signal.SendAnyway',
      callback: async() => {
        const isSent = await managers.appSignalManager.callSignal('sendMessageAnyway', {messageId});
        if(!isSent) toastNew({langPackKey: 'Signal.ResendFailed'});
      }
    }, ...verifyButtons, {
      langKey: 'Cancel',
      isCancel: true
    }]
  });
}
