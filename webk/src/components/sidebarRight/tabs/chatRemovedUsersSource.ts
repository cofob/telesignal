import type AppSelectPeers from '@components/appSelectPeers';
import createParticipantContextMenu
from '@helpers/dom/createParticipantContextMenu';
import showPickUserPopup from '@components/popups/pickUser';
import hasRights from '@appManagers/utils/chats/hasRights';
import type {Chat} from '@layer';
import type {Middleware} from '@helpers/middleware';
import {toSignalPeerId} from '@lib/signal/builders';
import {createSelectorForParticipants} from './participantsSelector';
import {
  isRemovedParticipant,
  type RemovedUsersSelectorOptions,
  type RemovedUsersSource,
  type RemovedUsersTab
} from './removedUsersSource';

export default async function createChatRemovedUsersSource(options: {
  tab: RemovedUsersTab,
  chatId: ChatId,
  middleware: Middleware
}): Promise<RemovedUsersSource> {
  const {tab, chatId, middleware} = options;
  const peerId = chatId.toPeerId(true);
  const [chat, isBroadcast] = await Promise.all([
    tab.managers.appChatsManager.getChat(chatId) as Promise<
      Chat.chat | Chat.channel
    >,
    tab.managers.appChatsManager.isBroadcast(chatId)
  ]);
  let selector: AppSelectPeers;
  const canChangePermissions = hasRights(chat, 'change_permissions');
  // * TeleSignal: a Signal group (a basic group here) unbans through the provider, as Web A's
  // * `ManageChatRemovedUsers` does, and its list changes with the row taken out
  const isSignalGroup = chat._ === 'chat';

  return {
    canChangePermissions,
    caption: isBroadcast ? 'NoBlockedChannel2' : 'NoBlockedGroup2',
    createSelector: (selectorOptions: RemovedUsersSelectorOptions) => {
      const result = createSelectorForParticipants({
        ...selectorOptions,
        peerId,
        channelParticipantsFilter: (q) => ({
          _: 'channelParticipantsKicked',
          q
        }),
        channelParticipantsUpdatePeerId: peerId,
        channelParticipantsUpdateFilter: isSignalGroup ? undefined : isRemovedParticipant
      });
      selector = result.selector;
      return result;
    },
    openAddParticipant: () => {
      const popup = showPickUserPopup({
        titleLangKey: 'RemovedUsers',
        peerType: ['channelParticipants'],
        peerId,
        onSelect: (chosen) => {
          const participant = popup.selector.participants.get(
            chosen[0].peerId
          );
          return tab.managers.appChatsManager.kickFromChat(
            chatId,
            participant
          );
        },
        placeholder: 'SearchPlaceholder'
      });
    },
    attachSelectorBehavior: (currentSelector) => {
      createParticipantContextMenu({
        chatId,
        listenTo: currentSelector.scrollable.container,
        participants: currentSelector.participants,
        slider: tab.slider,
        middleware,
        bannedParticipantAdapter: isSignalGroup ? {
          hasRights: () => canChangePermissions,
          unban: async(participantPeerId) => {
            // * a refusal is reported by the provider itself
            const result = await tab.managers.appSignalManager.callSignal('updateChatMemberBannedRights', {
              chat: {id: toSignalPeerId(peerId)},
              peer: {id: toSignalPeerId(participantPeerId)},
              bannedRights: {}
            });
            if(!result) return;
            currentSelector.participants.delete(participantPeerId);
            currentSelector.deletePeerId(participantPeerId);
          }
        } : undefined
      });
    }
  };
}
