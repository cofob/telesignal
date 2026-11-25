import {createMemo, createSignal, onCleanup} from 'solid-js';
import {User} from '@layer';
import {AppManagers} from '@lib/managers';
import getPeerActiveUsernames from '@appManagers/utils/peers/getPeerActiveUsernames';
import {buildTelegramUserQrUrl} from '@helpers/qrCode/paintQrCode';
import {Caption} from '@components/popups/myQrCode/caption';
import {createCountdown} from '@components/popups/myQrCode/countdown';
import {buildPhoneUrl, chooseOwnLink, linkCaption, OwnLinkKind} from '@components/popups/myQrCode/link';

// `QrShareServer.CONTACT_TOKEN_RETRY`
const RETRY_MS = 5000;

/**
 * What the code carries and what stands under it: the username, else the phone, else a temporary contact link that
 * counts down and is made anew at zero. For the own profile; another peer's link is a plain one.
 */
export default function createQrLink(options: {
  managers: AppManagers,
  peer: User.user,
  /** Only the own profile has these links */
  enabled: boolean
}) {
  const {managers, peer, enabled} = options;

  const username = enabled ? getPeerActiveUsernames(peer)[0] : undefined;
  const [kind, setKind] = createSignal<OwnLinkKind | undefined>(username ? 'username' : undefined);
  const [contact, setContact] = createSignal<{url: string, expires: number}>();

  let retryTimer: number, disposed = false;
  onCleanup(() => {
    disposed = true;
    clearTimeout(retryTimer);
  });

  // a failed refresh keeps the link on screen; the next try is a moment later, while there is a screen to show it
  const exportContact = async() => {
    try {
      const token = await managers.appUsersManager.exportContactToken();
      setContact({url: token.url, expires: token.expires});
      return true;
    } catch{
      if(!disposed) retryTimer = window.setTimeout(exportContact, RETRY_MS);
      return false;
    }
  };

  if(enabled && !username) {
    (async() => {
      // rules that cannot be read leave the phone out, as on Android
      let chosen: OwnLinkKind = 'contact';
      try {
        const [phoneRules, addedByPhoneRules] = await Promise.all([
          managers.appPrivacyManager.getPrivacy('inputPrivacyKeyPhoneNumber'),
          managers.appPrivacyManager.getPrivacy('inputPrivacyKeyAddedByPhone')
        ]);
        chosen = chooseOwnLink({phone: peer.phone, phoneRules, addedByPhoneRules});
      } catch{}

      if(chosen === 'contact') await exportContact();
      setKind(chosen);
    })();
  }

  const contactExpires = () => kind() === 'contact' ? contact()?.expires : undefined;
  const left = createCountdown(contactExpires, () => { exportContact(); });

  /** The link; empty while it is still being chosen */
  const url = createMemo(() => {
    switch(kind()) {
      case 'username': return buildTelegramUserQrUrl(username);
      case 'phone': return buildPhoneUrl(peer.phone ?? '');
      case 'contact': return contact()?.url ?? '';
      default: return '';
    }
  });

  const caption = createMemo<Caption | undefined>(() => {
    switch(kind()) {
      case 'username': return linkCaption('username', username);
      case 'phone': return linkCaption('phone', peer.phone);
      // a contact link has no caption: the card is a square, and the time left stands in a pill under it (as on Android)
    }
  });

  return {
    enabled,
    kind,
    url,
    /** Seconds left to the contact link; the pill under the square card counts them */
    left,
    caption,
    /** When the contact link on screen runs out (unix seconds) */
    expires: contactExpires
  };
}
