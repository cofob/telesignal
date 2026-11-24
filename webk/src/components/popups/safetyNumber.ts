import confirmationPopup from '@components/confirmationPopup';
import {toastNew} from '@components/toast';
import rootScope from '@lib/rootScope';
import noop from '@helpers/noop';
import {paintQrCode} from '@helpers/qrCode/paintQrCode';
import {bindManagersToSession} from '@lib/accounts/bindManagersToAccount';
import styles from '@components/popups/safetyNumber.module.scss';

// Signal shows the 60 digits in groups of five
const BLOCK_PATTERN = /.{1,5}/g;
const QR_SIZE = 160;

/**
 * The safety number with a contact and its QR code, which their phone can scan (Signal Desktop
 * `SafetyNumberViewer`), to mark as verified or clear the mark. Automatic key verification is not in this popup yet.
 */
export default async function showSafetyNumberPopup(peerId: PeerId) {
  const managers = bindManagersToSession(rootScope.managers);
  const safetyNumber = await managers.appSignalManager.fetchSafetyNumber(peerId);
  if(!safetyNumber) {
    toastNew({langPackKey: 'Error.AnError'});
    return;
  }

  const {digits, qrData, isVerified} = safetyNumber;
  const card = document.createElement('div');
  card.classList.add(styles.card);
  if(qrData) paintSafetyNumberQrCode(card, qrData);

  await confirmationPopup({
    titleLangKey: 'SafetyNumber.Title',
    contentBefore: qrData ? card : undefined,
    descriptionRaw: digits.match(BLOCK_PATTERN)!.join(' '),
    button: {
      langKey: isVerified ? 'SafetyNumber.ClearVerification' : 'SafetyNumber.MarkVerified',
      callback: () => managers.appSignalManager.updateSafetyNumberVerified(peerId, !isVerified)
    }
  }).catch(noop);
}

/** The scannable form of the safety number: one character per byte, as the provider gives it */
async function paintSafetyNumberQrCode(host: HTMLElement, data: string) {
  try {
    const QRCodeStylingCtor = await import('qr-code-styling' as any).then((m) => m.default);
    await paintQrCode({
      data,
      mode: 'Byte',
      size: QR_SIZE,
      host,
      background: '#ffffff',
      foreground: '#000000',
      canvasClass: styles.qr,
      QRCodeStylingCtor
    });
  } catch(err) {
    // * the digits still say the same
    console.error('safety number QR code paint failed', err);
  }
}
