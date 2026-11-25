import {LangPackKey} from '@lib/langPack';
import {ApiLimitType} from '@appManagers/apiManagerMethods';
import rootScope from '@lib/rootScope';
import showPeerPopup, {PopupPeerButton} from '@components/popups/peer';
import LimitLine from '@components/limit';

type LimitStrings = {
  title: LangPackKey,
  description: LangPackKey,
  icon: Icon
};

// * every list of pins says it the same way, with its own numbers
const PIN_LIMIT: LimitStrings = {
  title: 'LimitReached',
  description: 'LimitReachedPinDialogsLocked',
  icon: 'limit_pin_filled'
};

const a: {[type in ApiLimitType]?: LimitStrings} = {
  pin: PIN_LIMIT,
  // * the archive's pins: the same box with the archive's numbers (tdesktop's FolderPinsLimitBox)
  folderPin: PIN_LIMIT,
  folders: {
    title: 'LimitReached',
    description: 'LimitReachedFoldersLocked',
    icon: 'limit_folders'
  },
  folderPeers: {
    title: 'LimitReached',
    description: 'LimitReachedChatInFoldersLocked',
    icon: 'limit_folders'
  },
  chatlistInvites: {
    title: 'LimitReached',
    description: 'LimitReachedSharedFolderInvitesLocked',
    icon: 'limit_link'
  },
  savedPin: PIN_LIMIT,
  channels: {
    title: 'LimitReached',
    description: 'LimitReachedCommunitiesLocked',
    icon: 'limit_chat_filled'
  }
};

/** What `channelsTooMuch` needs to dress the popup: its own body, its buttons and the moment to show. */
export type LimitPopupContext = {
  body: HTMLElement,
  buttons: PopupPeerButton[],
  show: () => void,
  hide: () => void,
  onCloseAfterTimeout: (callback: () => void) => void
};

/** The limit of the list, which Signal has no way to raise: the popup only says it is reached */
export default async function showLimitPopup(
  type: keyof typeof a,
  popupRef?: (context: LimitPopupContext) => void
) {
  const limit = await rootScope.managers.apiManager.getLimit(type);
  const strings = a[type];

  const buttons: PopupPeerButton[] = [{
    langKey: 'LimitReached.Ok',
    isCancel: true
  }];

  const limitLine = new LimitLine({
    hint: {
      icon: strings.icon,
      content: '' + limit
    }
  });
  limitLine.container.querySelector('.limit-line')?.remove();

  // the picker `channelsTooMuch` builds lives here, where the popup body used to be
  const body = popupRef ? document.createElement('div') : undefined;
  body?.classList.add('popup-body');

  let onCloseAfterTimeout: () => void;
  const handle = showPeerPopup('popup-limit', {
    buttons,
    descriptionLangKey: strings.description,
    descriptionLangArgs: [limit],
    titleLangKey: strings.title,
    contentBefore: limitLine.container,
    content: body,
    deferShow: !!popupRef,
    onCloseAfterTimeout: () => onCloseAfterTimeout?.()
  });

  limitLine._setHintActive();

  popupRef?.({
    body,
    buttons,
    show: handle.show,
    hide: handle.hide,
    onCloseAfterTimeout: (callback) => onCloseAfterTimeout = callback
  });
}
