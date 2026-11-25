/*
 * The moderation actions behind the delete-messages popup, kept apart from the popup itself so they
 * stay unit-testable without pulling the whole popup UI graph into jsdom.
 */

import {Chat, ChatFull} from '@layer';
import {AppManagers} from '@lib/managers';
import rootScope from '@lib/rootScope';
import canEditAdmin from '@appManagers/utils/chats/canEditAdmin';
import {ChatPermissions} from '@components/sidebarRight/tabs/groupPermissions/sharedPermissions';
import {
  DeleteAction,
  DeleteCheckboxFieldsField,
  ModerateMessage,
  ModerateOptions,
  ModerateReactionEntry,
  getNoModerateOptions
} from '@components/popups/deleteMegagroupMessagesShared';

/** What the confirm step and the moderation-options lookup read — a popup, or a test's stand-in. */
export type DeleteMegagroupContext = {
  fields: DeleteCheckboxFieldsField[],
  messages: ModerateMessage[],
  reaction?: ModerateReactionEntry,
  restricting?: boolean,
  chatPermissions?: ChatPermissions,
  reportReaction?: boolean,
  managers: AppManagers,
  onConfirm?: () => void
};

export async function confirmDeleteMegagroupMessages(ctx: DeleteMegagroupContext) {
  const byPeers = ctx.fields.reduce((acc, field) => {
    if(field.peerId === undefined || field.action === 'deleteOptions' || !field.checkboxField.checked) {
      return acc;
    }

    let set = acc.get(field.peerId);
    if(!set) {
      acc.set(field.peerId, set = new Set());
    }

    set.add(field.action);
    return acc;
  }, new Map<PeerId, Set<DeleteAction>>());

  const mids = ctx.messages.length ?
    ctx.messages.map(({mid}) => mid) :
    [ctx.reaction.message.mid];
  const peerId = ctx.reaction?.message.peerId ?? ctx.messages[0].peerId;
  const deleteOriginReactions = !!ctx.reaction &&
    byPeers.get(ctx.reaction.participantPeerId)?.has('deleteReactions');
  const {restricting, managers} = ctx;
  for(const [fromId, actions] of byPeers) {
    const promises: Promise<any>[] = [];
    if(actions.has('ban') && restricting) {
      const rights = ctx.chatPermissions.takeOut();
      promises.push(managers.appChatsManager.editBanned(peerId.toChatId(), fromId, rights));
    } else if(actions.has('ban')) {
      promises.push(managers.appChatsManager.kickFromChannel(peerId.toChatId(), fromId));
    }

    if(actions.has('report')) {
      if(ctx.reaction && ctx.reportReaction && fromId === ctx.reaction.participantPeerId) {
        promises.push(managers.appReactionsManager.reportParticipantReaction({
          peerId,
          mid: ctx.reaction.message.mid,
          participantPeerId: fromId
        }));
      } else {
        promises.push(managers.appMessagesManager.reportSpamMessages(peerId, fromId, mids));
      }
    }

    if(actions.has('delete')) {
      promises.push(managers.appMessagesManager.doFlushHistory({peerId, justClear: false, revoke: true, participantPeerId: fromId}));
    }

    if(actions.has('deleteReactions')) {
      promises.push(managers.appReactionsManager.deleteParticipantReactions({
        peerId,
        participantPeerId: fromId,
        ...(ctx.reaction?.participantPeerId === fromId ? {
          originMid: ctx.reaction.message.mid,
          knownReaction: ctx.reaction.knownReaction
        } : {})
      }));
    }
  }

  if(ctx.reaction && !deleteOriginReactions) {
    managers.appReactionsManager.deleteParticipantReaction({
      peerId,
      mid: ctx.reaction.message.mid,
      participantPeerId: ctx.reaction.participantPeerId,
      knownReaction: ctx.reaction.knownReaction
    });
  }

  if(ctx.messages.length) {
    managers.appMessagesManager.deleteMessages(peerId, mids, true);
  }

  ctx.onConfirm?.();
  return true;
}

export async function getModerateOptionsFor(ctx: Pick<DeleteMegagroupContext, 'reaction' | 'managers'>, peerId: PeerId): Promise<ModerateOptions> {
  if(!ctx.reaction) {
    return {
      reportSpam: true,
      reportReaction: false,
      deleteAllMessages: true,
      deleteAllReactions: true,
      banOrRestrict: true
    };
  }

  const participantPeerId = ctx.reaction.participantPeerId;
  if(participantPeerId === peerId || participantPeerId === rootScope.myId) {
    return getNoModerateOptions();
  }

  const chatId = peerId.toChatId();
  if(participantPeerId.isAnyChat()) {
    const participantFull = await ctx.managers.appProfileManager
    .getChatFull(participantPeerId.toChatId())
    .catch((): undefined => undefined);
    if((participantFull as ChatFull.channelFull)?.linked_chat_id === chatId) {
      return getNoModerateOptions();
    }
  }

  const [chat, canDeleteMessages, canBanUsers, isPublic] = await Promise.all([
    ctx.managers.appChatsManager.getChat(chatId) as Promise<Chat>,
    ctx.managers.appChatsManager.hasRights(chatId, 'delete_messages'),
    ctx.managers.appChatsManager.hasRights(chatId, 'ban_users'),
    ctx.managers.appChatsManager.isPublic(chatId)
  ]);
  const isChannel = chat?._ === 'channel';
  const isMegagroup = isChannel && !!chat.pFlags.megagroup;
  let banOrRestrict = false;

  if(isChannel && canBanUsers) {
    if(chat.pFlags.creator) {
      banOrRestrict = true;
    } else {
      const participant = await ctx.managers.appProfileManager.getParticipant(chatId, participantPeerId).catch((): undefined => undefined);
      banOrRestrict = !!participant && canEditAdmin(chat, participant, rootScope.myId);
    }
  }

  return {
    reportSpam: isChannel,
    reportReaction: isMegagroup && isPublic,
    deleteAllMessages: isChannel && canDeleteMessages,
    deleteAllReactions: canDeleteMessages,
    banOrRestrict
  };
}
