import confirmationPopup from '@components/confirmationPopup';
import type {PopupPeerButton} from '@components/popups/peer';
import {toastNew} from '@components/toast';
import {copyTextToClipboard} from '@helpers/clipboard';
import noop from '@helpers/noop';
import {i18n} from '@lib/langPack';
import {confirmRecoveryKeySaved, fetchRecoveryKey} from '@lib/signal/settingsApi';

/**
 * The recovery key of the account, as Web A's `RecoveryKeyModal`: with copying, and with the confirmation that it is
 * saved, which a new account asks for once (`shouldSkipConfirmed`: shown only then, as at the start after a
 * registration). A linked device has no key to show.
 */
export default async function showRecoveryKeyPopup(shouldSkipConfirmed?: boolean) {
  const result = await fetchRecoveryKey();
  if(shouldSkipConfirmed && !result?.isUnconfirmed) return;
  if(!result) {
    toastNew({langPackKey: 'RecoveryKeyUnavailable'});
    return;
  }

  const savedButton: PopupPeerButton = {
    langKey: 'RecoveryKeySaved',
    callback: () => {
      if(result.isUnconfirmed) confirmRecoveryKeySaved();
    }
  };

  confirmationPopup({
    titleLangKey: 'RecoveryKeyRecord',
    descriptionLangKey: 'RecoveryKeyText',
    content: (
      <>
        <p class="popup-description" style={{'font-family': 'var(--font-monospace)', 'user-select': 'all'}}>
          {result.key}
        </p>
        <p class="popup-description">{i18n('RecoveryKeyWarning')}</p>
      </>
    ),
    button: savedButton,
    buttons: [{
      langKey: 'RecoveryKeyCopy',
      callback: () => {
        copyTextToClipboard(result.key);
        toastNew({langPackKey: 'RecoveryKeyCopied'});
        return false;
      }
    }, savedButton]
  }).catch(noop);
}
