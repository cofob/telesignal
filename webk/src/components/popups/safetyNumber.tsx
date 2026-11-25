import {createSignal, onMount, Show} from 'solid-js';
import confirmationPopup from '@components/confirmationPopup';
import {toastNew} from '@components/toast';
import RowTsx from '@components/rowTsx';
import getPeerTitle from '@components/wrappers/getPeerTitle';
import rootScope from '@lib/rootScope';
import {i18n, LangPackKey} from '@lib/langPack';
import setBlankToAnchor from '@lib/richTextProcessor/setBlankToAnchor';
import noop from '@helpers/noop';
import {paintQrCode} from '@helpers/qrCode/paintQrCode';
import {bindManagersToSession} from '@lib/accounts/bindManagersToAccount';
import type {SignalKeyTransparencyStatus} from '@lib/signal/userMethods';
import styles from '@components/popups/safetyNumber.module.scss';

// Signal shows the 60 digits in groups of five
const BLOCK_PATTERN = /.{1,5}/g;
const QR_SIZE = 160;
// * Web A's `KEY_TRANSPARENCY_URL`
const KEY_TRANSPARENCY_URL = 'https://support.signal.org/hc/articles/10223569377562';
// * the button and the explanation of each result, as Web A's `SafetyNumberModal`
const KEY_TRANSPARENCY_ICONS: Record<SignalKeyTransparencyStatus, Icon> = {
  idle: 'key',
  running: 'key',
  ok: 'checkround_filled',
  fail: 'warning_filled',
  error: 'info',
  unavailable: 'info'
};
const KEY_TRANSPARENCY_BUTTON_KEYS: Record<SignalKeyTransparencyStatus, LangPackKey> = {
  idle: 'KeyTransIdle',
  running: 'KeyTransRunning',
  ok: 'KeyTransOk',
  fail: 'KeyTransFail',
  error: 'KeyTransError',
  unavailable: 'KeyTransUnavailable'
};
const KEY_TRANSPARENCY_TEXT_KEYS: Partial<Record<SignalKeyTransparencyStatus, LangPackKey>> = {
  ok: 'KeyTransOkText',
  fail: 'KeyTransFailText',
  error: 'KeyTransErrorText',
  unavailable: 'KeyTransUnavailableText'
};

/**
 * The safety number with a contact and its QR code, which their phone can scan (Signal Desktop
 * `SafetyNumberViewer`), to mark as verified or clear the mark. Below it, automatic key verification (key
 * transparency) checks the contact's identity key against Signal's log of keys when the popup opens, as Web A's
 * `SafetyNumberModal`.
 */
export default async function showSafetyNumberPopup(peerId: PeerId) {
  const managers = bindManagersToSession(rootScope.managers);
  const safetyNumber = await managers.appSignalManager.fetchSafetyNumber(peerId);
  if(!safetyNumber) {
    toastNew({langPackKey: 'Error.AnError'});
    return;
  }

  const {digits, qrData, isVerified, keyTransparencyStatus} = safetyNumber;
  const card = document.createElement('div');
  card.classList.add(styles.card);
  if(qrData) paintSafetyNumberQrCode(card, qrData);

  const name = await getPeerTitle({peerId, plainText: true});
  await confirmationPopup({
    titleLangKey: 'SafetyNumber.Title',
    contentBefore: qrData ? card : undefined,
    descriptionRaw: digits.match(BLOCK_PATTERN)!.join(' '),
    content: (
      <KeyTransparency
        initialStatus={keyTransparencyStatus}
        name={name}
        check={() => managers.appSignalManager.checkKeyTransparency(peerId)}
      />
    ),
    button: {
      langKey: isVerified ? 'SafetyNumber.ClearVerification' : 'SafetyNumber.MarkVerified',
      callback: () => managers.appSignalManager.updateSafetyNumberVerified(peerId, !isVerified)
    }
  }).catch(noop);

  // * the check stops at its next request, such as the one that waits out a rate limit
  managers.appSignalManager.cancelKeyTransparencyCheck(peerId);
}

function KeyTransparency(props: {
  initialStatus: SignalKeyTransparencyStatus,
  name: string,
  check: () => Promise<SignalKeyTransparencyStatus | undefined>
}) {
  const [status, setStatus] = createSignal(props.initialStatus);

  const check = async() => {
    if(status() === 'running' || status() === 'unavailable') return;
    setStatus('running');
    setStatus(await props.check() ?? 'fail');
  };

  onMount(() => {
    if(status() === 'idle') check();
  });

  const learnMore = setBlankToAnchor(document.createElement('a'));
  learnMore.href = KEY_TRANSPARENCY_URL;
  learnMore.append(i18n('KeyTransLearnMore'));

  return (
    <div class={styles.keyTransparency}>
      <div class={styles.keyTransparencyTitle}>{i18n('KeyTransTitle')}</div>
      <RowTsx clickable={status() === 'running' || status() === 'unavailable' ? undefined : check}>
        <RowTsx.Icon icon={KEY_TRANSPARENCY_ICONS[status()]} />
        <RowTsx.Title>{i18n(KEY_TRANSPARENCY_BUTTON_KEYS[status()])}</RowTsx.Title>
      </RowTsx>
      <Show when={KEY_TRANSPARENCY_TEXT_KEYS[status()]}>
        {(key) => <p class={styles.text}>{i18n(key(), [props.name])}</p>}
      </Show>
      <p class={styles.text}>
        {i18n('KeyTransHint')}
        {' '}
        {learnMore}
      </p>
    </div>
  );
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
