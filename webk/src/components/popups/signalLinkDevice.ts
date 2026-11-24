/*
 * TeleSignal: links another device to the account from the primary device, as Web A's `LinkDeviceModal` does: the
 * link of the new device's QR code goes in the field, the popup says that the new device gets full access, and a
 * link that came from elsewhere (a message, the search) is linked only by a click, never by Enter.
 */

import type {LangPackKey} from '@lib/langPack';
import confirmationPopup from '@components/confirmationPopup';
import InputField from '@components/inputField';
import {toastNew} from '@components/toast';
import {i18n} from '@lib/langPack';
import {linkDevice} from '@lib/signal/settingsApi';

const LINK_ERROR_KEYS: Record<string, LangPackKey> = {
  badCode: 'Signal.Devices.LinkBadCode',
  limit: 'Signal.Devices.LinkLimit',
  rejected: 'Signal.Devices.LinkRejected',
  rateLimited: 'Signal.Devices.LinkRateLimited',
  noKey: 'Signal.Devices.LinkNoKey'
};

export default function showLinkDevicePopup({url, onLinked}: {
  /** The link that came from elsewhere, which the field shows */
  url?: string,
  onLinked?: () => void
} = {}) {
  const inputField = new InputField({
    label: 'Signal.Devices.LinkField',
    plainText: true,
    required: true,
    withLinebreaks: false
  });
  if(url) {
    inputField.value = url;
    inputField.input.addEventListener('keydown', (e) => {
      // * the popup confirms on Enter unless the key was handled: a link the user did not type needs a click
      if(e.key === 'Enter' && inputField.value.trim() === url) e.preventDefault();
    });
  }

  const warning = document.createElement('p');
  warning.classList.add('popup-description');
  warning.append(i18n('Signal.Devices.LinkWarning'));

  confirmationPopup({
    titleLangKey: 'Signal.Devices.LinkTitle',
    descriptionLangKey: 'Signal.Devices.LinkText',
    inputField,
    content: warning,
    button: {
      langKey: 'Signal.Devices.LinkConfirm',
      callback: async() => {
        // * a failed attempt keeps the popup open with the link in the field, as the field's own check does
        const result = await linkDevice(inputField.value.trim());
        if(!result) {
          toastNew({langPackKey: 'Signal.Devices.LinkNetwork'});
          return false;
        }

        if(result.error) {
          toastNew({langPackKey: LINK_ERROR_KEYS[result.error] || 'Signal.Devices.LinkNetwork'});
          return false;
        }

        toastNew({langPackKey: result.isPending ? 'Signal.Devices.LinkPending' : 'Signal.Devices.Linked'});
        onLinked?.();
      }
    }
  }).catch(() => {});
}
