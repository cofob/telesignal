/*
 * TeleSignal: the chats that came back while Web K was closed. Telegram's Web K keeps its chat list in its own state
 * and catches up through `updates.getDifference`, which Signal has no equivalent of: a chat that Web K deleted, or never
 * had, and that got a message meanwhile (a message request again, a reseeded demo) stays out of the list, as the
 * cached list counts as loaded. Once the engine has started, the provider's first page of chats is compared with Web
 * K's dialogs, and each missing one is loaded as a dialog of its own (`messages.getPeerDialogs`), which puts it in its
 * place in the list.
 */

import type {AppMessagesManager} from '@appManagers/appMessagesManager';
import type DialogsStorage from '@lib/storages/dialogs';
import type {SignalChats} from '@lib/signal/signalApi';
import type {SignalMethodHost} from '@lib/signal/methodHost';
import {toPeerId} from '@lib/signal/builders';

// * as many chats as the list shows at first, which is where a chat with a new message stands
const FIRST_PAGE_LIMIT = 100;

export async function restoreMissingDialogs(
  host: Pick<SignalMethodHost, 'call'>,
  dialogsStorage: DialogsStorage,
  appMessagesManager: AppMessagesManager
) {
  const results = await Promise.all([false, true].map((archived) => {
    return host.call<SignalChats | undefined>('fetchChats', {limit: FIRST_PAGE_LIMIT, archived, withPinned: true});
  }));

  for(const result of results) {
    for(const chatId of result?.chatIds ?? []) {
      const peerId = toPeerId(chatId);
      if(!dialogsStorage.getDialogOnly(peerId)) {
        appMessagesManager.reloadConversation(peerId);
      }
    }
  }
}
