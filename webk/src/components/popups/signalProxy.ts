import confirmationPopup from '@components/confirmationPopup';
import InputField, {InputState} from '@components/inputField';
import {toastNew} from '@components/toast';
import {saveSignalProxySettings, SignalProxySettings} from '@lib/signal/proxySettings';
import {checkSignalProxyUrl, parseSignalProxyUrl} from '@signal-app/signal-proxy';
import type {PopupPeerButton} from '@components/popups/peer';

/**
 * The form of a proxy server, as Web A's `SignalProxyForm`: save, check the connection, or go back to the default.
 * `onSaveAttempt` runs after every save, also one whose engine restart failed, as the URL is stored by then.
 */
export default function showSignalProxyPopup(
  key: keyof SignalProxySettings,
  savedUrl: string | undefined,
  onSaveAttempt?: () => void
) {
  const isSealedSender = key === 'signalSealedSenderProxyUrl';
  const inputField = new InputField({
    label: 'SignalProxyUrl',
    plainText: true,
    withLinebreaks: false
  });
  inputField.setValueSilently(savedUrl ?? '');
  // * an error describes the URL it was made for, as in Web A's form: editing hides it. Added before the popup's own
  // * listener, which then finds the field valid again
  inputField.input.addEventListener('input', () => inputField.setState(InputState.Neutral));

  const parse = () => {
    const {url, errorKey} = parseSignalProxyUrl(inputField.value);
    if(!url) inputField.setError(errorKey);
    return url;
  };

  const save = async(url: string | undefined) => {
    try {
      await saveSignalProxySettings({[key]: url});
    } catch(err) {
      toastNew({langPackKey: 'Error.AnError'});
      return false;
    } finally {
      onSaveAttempt?.();
    }
  };

  const saveButton: PopupPeerButton = {
    langKey: 'Save',
    callback: () => {
      if(!inputField.value.trim()) {
        return save(undefined);
      }

      const url = parse();
      return url ? save(url) : false;
    }
  };

  const checkButton: PopupPeerButton = {
    langKey: 'SignalProxyCheck',
    callback: async() => {
      const url = parse();
      if(url) {
        const isReachable = await checkSignalProxyUrl(url);
        toastNew({langPackKey: isReachable ? 'SignalProxyReachable' : 'SignalProxyUnreachable'});
      }

      return false;
    }
  };

  const resetButton: PopupPeerButton = savedUrl && {
    langKey: isSealedSender ? 'SignalSealedProxyUseMain' : 'SignalProxyUseDefault',
    callback: () => save(undefined)
  };

  confirmationPopup({
    titleLangKey: isSealedSender ? 'SignalSealedProxyTitle' : 'SignalProxyTitle',
    descriptionLangKey: isSealedSender ? 'SignalSealedProxyAbout' : 'SignalProxyAbout',
    inputField,
    button: saveButton,
    buttons: [saveButton, checkButton, resetButton].filter(Boolean)
  }).catch(() => {});
}
