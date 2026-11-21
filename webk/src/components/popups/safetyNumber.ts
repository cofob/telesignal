import confirmationPopup from '@components/confirmationPopup';
import {toastNew} from '@components/toast';
import rootScope from '@lib/rootScope';
import noop from '@helpers/noop';
import {bindManagersToSession} from '@lib/accounts/bindManagersToAccount';

// Signal shows the 60 digits in groups of five
const BLOCK_PATTERN = /.{1,5}/g;

/**
 * The safety number with a contact, to compare on both devices, and to mark as verified or clear the mark. Signal's
 * QR code and automatic key verification are not in this popup yet.
 */
export default async function showSafetyNumberPopup(peerId: PeerId) {
  const managers = bindManagersToSession(rootScope.managers);
  const safetyNumber = await managers.appSignalManager.fetchSafetyNumber(peerId);
  if(!safetyNumber) {
    toastNew({langPackKey: 'Error.AnError'});
    return;
  }

  const {digits, isVerified} = safetyNumber;
  await confirmationPopup({
    titleLangKey: 'SafetyNumber.Title',
    descriptionRaw: digits.match(BLOCK_PATTERN)!.join(' '),
    button: {
      langKey: isVerified ? 'SafetyNumber.ClearVerification' : 'SafetyNumber.MarkVerified',
      callback: () => managers.appSignalManager.updateSafetyNumberVerified(peerId, !isVerified)
    }
  }).catch(noop);
}
