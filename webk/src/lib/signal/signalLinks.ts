/*
 * TeleSignal: opens a Signal link (`signal.me`, `signal.group`, `signal.art`, `sgnl:` and the others that Web A's
 * `parseSignalLink` reads) from the search field or a message, as Web A's `openSignalLink` (`src/util/deeplink.ts`)
 * does: a username link opens its chat, a number is looked up only after the user agrees, a group link shows its
 * invite, a sticker pack link its pack, and the links that TeleSignal cannot follow say why.
 */

import type {LangPackKey} from '@lib/langPack';
import type {SignalLink} from '@signal-app/signal-links';
import confirmationPopup from '@components/confirmationPopup';
import showStickersPopup from '@components/popups/stickers';
import showSignalProxyPopup from '@components/popups/signalProxy';
import {toastNew} from '@components/toast';
import {INTERNAL_LINK_TYPE} from '@lib/internalLink';
import rootScope from '@lib/rootScope';
import {bindManagersToSession} from '@lib/accounts/bindManagersToAccount';
import {hotReloadGuard} from '@lib/solidjs/hotReloadGuardProvider';
import {fetchIsPrimaryDevice} from '@lib/signal/settingsApi';
import showLinkDevicePopup from '@components/popups/signalLinkDevice';
import {getSignalProxySettings} from '@lib/signal/proxySettings';

// * the links that TeleSignal cannot follow, with Web A's `SignalLinkModal` texts
const UNSUPPORTED_LINK_TEXTS: Record<'callLink' | 'linkDevice' | 'reRegister', [LangPackKey, LangPackKey]> = {
  callLink: ['SignalCallLinkTitle', 'SignalCallLinkText'],
  linkDevice: ['SignalDeviceLinkTitle', 'SignalDeviceLinkText'],
  reRegister: ['SignalReRegisterTitle', 'SignalReRegisterText']
};

export async function openSignalLink(link: SignalLink) {
  const managers = bindManagersToSession(rootScope.managers);
  switch(link.type) {
    case 'usernameLink': {
      const username: string = await managers.appSignalManager.callSignal('resolveUsernameLink', link.url);
      const user = username && await Promise.resolve(managers.appUsersManager.resolveUsername(username)).catch((): undefined => undefined);
      if(!user) {
        toastNew({langPackKey: 'SignalUsernameLinkInvalid'});
        return;
      }

      hotReloadGuard.appImManager.setInnerPeer({peerId: user.id.toPeerId(false)});
      return;
    }
    case 'phoneNumber':
      return lookUpPhoneNumber(link.phoneNumber);
    case 'groupInvite':
      return hotReloadGuard.internalLinkProcessor.processInternalLink({_: INTERNAL_LINK_TYPE.JOIN_CHAT, invite: link.url});
    case 'stickerPack':
      showStickersPopup({_: 'inputStickerSetID', id: link.packId, access_hash: link.packKey});
      return;
    case 'proxy':
      return confirmationPopup({
        titleLangKey: 'SignalProxyLinkTitle',
        descriptionLangKey: 'SignalProxyLinkText',
        descriptionLangArgs: [link.host],
        button: {
          langKey: 'SignalProxySettings',
          callback: async() => {
            showSignalProxyPopup('signalProxyUrl', (await getSignalProxySettings()).signalProxyUrl);
          }
        }
      }).catch(() => {});
    case 'linkDevice':
      // * a primary device links the new device, as Web A's `openSignalLinkDevice` does
      if(await fetchIsPrimaryDevice()) return showLinkDevicePopup({url: link.url});
      return showUnsupportedLink(link.type);
    case 'callLink':
    case 'reRegister':
      return showUnsupportedLink(link.type);
    case 'invalid':
      toastNew({langPackKey: 'SignalLinkInvalid'});
      return;
  }
}

/**
 * Looks a number up on Signal and opens its chat, once the user agrees: a number can come from anyone, and looking it
 * up tells Signal's contact discovery service about it, as Web A's `PhoneNumberLookupModal` says. Every lookup of a
 * number from a link goes through here.
 */
export async function lookUpPhoneNumber(phone: string, text?: string) {
  const managers = bindManagersToSession(rootScope.managers);
  const phoneNumber = phone.replace(/\D/g, '');
  try {
    await confirmationPopup({
      titleLangKey: 'SignalPhoneLookupTitle',
      descriptionLangKey: 'SignalPhoneLookupText',
      descriptionLangArgs: ['+' + phoneNumber],
      button: {langKey: 'SignalPhoneLookupConfirm'}
    });
  } catch{
    return;
  }

  const user = await Promise.resolve(managers.appUsersManager.resolvePhone(phoneNumber)).catch((): undefined => undefined);
  if(!user) {
    toastNew({langPackKey: 'SignalPhoneLookupNotFound', langPackArguments: ['+' + phoneNumber]});
    return;
  }

  hotReloadGuard.appImManager.setInnerPeer({peerId: user.id.toPeerId(false), text});
}

function showUnsupportedLink(type: keyof typeof UNSUPPORTED_LINK_TEXTS) {
  const [titleLangKey, descriptionLangKey] = UNSUPPORTED_LINK_TEXTS[type];
  return confirmationPopup({
    titleLangKey,
    descriptionLangKey,
    button: {langKey: 'OK', isCancel: true}
  }).catch(() => {});
}
