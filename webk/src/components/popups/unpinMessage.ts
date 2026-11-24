import {addCancelButton} from './indexTsx';
import showPeerPopup, {PopupPeerButtonCallbackCheckboxes, PopupPeerOptions} from '@components/popups/peer';
import rootScope from '@lib/rootScope';
import {FormatterArguments, LangPackKey} from '@lib/langPack';
import {bindManagersToSession} from '@lib/accounts/bindManagersToAccount';

export default async function showPinMessagePopup(
  peerId: PeerId,
  mid: number,
  unpin?: true,
  onConfirm?: () => void,
  /** Forum topic the action is scoped to — the pinned list there is per-topic. */
  threadId?: number
) {
  let title: LangPackKey, description: LangPackKey, descriptionArgs: FormatterArguments;
  const buttons: PopupPeerOptions['buttons'] = [], checkboxes: PopupPeerOptions['checkboxes'] = [];

  const managers = bindManagersToSession(rootScope.managers);

  const canUnpin = await managers.appPeersManager.canPinMessage(peerId);

  const callback = (e: MouseEvent, checked: PopupPeerButtonCallbackCheckboxes, oneSide?: boolean, silent?: boolean) => {
    setTimeout(() => { // * костыль, потому что document.elementFromPoint вернёт popup-peer пока он будет закрываться
      let promise: Promise<any>;
      if(unpin && !mid) {
        if(canUnpin) {
          promise = managers.appMessagesManager.unpinAllMessages(peerId, threadId);
        } else {
          promise = managers.appMessagesManager.hidePinnedMessages(peerId, threadId);
        }
      } else {
        promise = managers.appMessagesManager.updatePinnedMessage(peerId, mid, unpin, silent, oneSide);
      }

      if(onConfirm) {
        promise.then(onConfirm);
      }
    }, 300);
  };

  if(unpin) {
    let buttonText: LangPackKey = 'UnpinMessage';
    if(!mid) {
      if(canUnpin) {
        title = 'Popup.Unpin.AllTitle';
        description = 'Chat.UnpinAllMessagesConfirmation';
        descriptionArgs = ['' + ((await managers.appMessagesManager.getPinnedMessagesCount(peerId, threadId)) || 1)];
      } else {
        title = 'Popup.Unpin.HideTitle';
        description = 'Popup.Unpin.HideDescription';
        buttonText = 'Popup.Unpin.Hide';
      }
    } else {
      title = 'UnpinMessageAlertTitle';
      description = 'Chat.Confirm.Unpin';
    }

    buttons.push({
      langKey: buttonText,
      isDanger: true,
      callback
    });
  } else {
    // * a Signal pin is for everyone in the chat: there is no pin for ourselves alone and no separate notification
    title = 'PinMessageAlertTitle';
    description = peerId.isAnyChat() ? 'PinMessageAlert' : 'PinMessageAlertChat';
    buttons.push({
      langKey: 'PinMessage',
      callback
    });
  }

  addCancelButton(buttons);

  showPeerPopup('popup-delete-chat', {
    peerId,
    titleLangKey: title,
    descriptionLangKey: description,
    descriptionLangArgs: descriptionArgs,
    buttons,
    checkboxes
  });
}
