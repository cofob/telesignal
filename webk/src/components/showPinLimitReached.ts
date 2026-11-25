import showLimitPopup from '@components/popups/limit';
import {toastNew} from '@components/toast';
import {REAL_FOLDERS} from '@appManagers/constants';

/**
 * Tells the user a pin did not happen because the list it was for is full - every kind of list says
 * so in its own way. Any other error is not about the limit and is left alone.
 *
 * `filterId` is the list the pin was for, in `dialogsStorage`'s own filter id space; `isSaved` says
 * the pinned dialog is a Saved Messages sublist instead of a chat.
 */
export default function showPinLimitReached(err: ApiError, {filterId, isSaved}: {
  filterId?: number,
  isSaved?: boolean
}) {
  if(err?.type !== 'PINNED_DIALOGS_TOO_MUCH' && err?.type !== 'PINNED_TOO_MUCH') {
    return;
  }

  if(isSaved) {
    showLimitPopup('savedPin');
  } else if(!REAL_FOLDERS.has(filterId)) {
    toastNew({langPackKey: 'PinFolderLimitReached'});
  } else {
    // * TeleSignal: Signal's limit of pinned chats has no Premium to raise it (`toggleChatPinned` of the provider)
    toastNew({langPackKey: 'Signal.Error.PinnedLimit'});
  }
}
