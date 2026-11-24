import confirmationPopup from '@components/confirmationPopup';
import type {PopupPeerButton} from '@components/popups/peer';
import {toastNew} from '@components/toast';
import {copyTextToClipboard} from '@helpers/clipboard';
import noop from '@helpers/noop';
import {i18n} from '@lib/langPack';
import {confirmRecoveryKeySaved, fetchRecoveryKey} from '@lib/signal/settingsApi';

import styles from '@components/popups/recoveryKey.module.scss';

/**
 * The recovery key of the account, as Web A's `RecoveryKeyModal`: with copying, and, for a new account that has not
 * confirmed it yet, the request to save it and the confirmation (`shouldSkipConfirmed`: shown only then, as at the
 * start after a registration). A linked device has no key to show. Settles once the popup is closed.
 */
export default async function showRecoveryKeyPopup(shouldSkipConfirmed?: boolean) {
  const result = await fetchRecoveryKey();
  if(shouldSkipConfirmed && !result?.isUnconfirmed) return;
  if(!result) {
    toastNew({langPackKey: 'RecoveryKeyUnavailable'});
    return;
  }

  const copyButton: PopupPeerButton = {
    langKey: 'RecoveryKeyCopy',
    callback: () => {
      copyTextToClipboard(result.key);
      toastNew({langPackKey: 'RecoveryKeyCopied'});
      return false;
    }
  };

  // * the key saved: one the user has to confirm still is confirmed with it, one confirmed already is only closed
  const doneButton: PopupPeerButton = result.isUnconfirmed ? {
    langKey: 'RecoveryKeySaved',
    callback: () => {
      confirmRecoveryKeySaved();
    }
  } : {langKey: 'Close'};

  await confirmationPopup({
    titleLangKey: result.isUnconfirmed ? 'RecoveryKeyRecord' : 'RecoveryKey',
    descriptionLangKey: 'RecoveryKeyText',
    content: (
      <>
        <p class={`popup-description ${styles.key}`}>{result.key}</p>
        <p class="popup-description">{i18n('RecoveryKeyWarning')}</p>
      </>
    ),
    button: doneButton,
    buttons: [copyButton, doneButton]
  }).catch(noop);
}
