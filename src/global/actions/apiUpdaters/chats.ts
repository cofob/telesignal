import type { ApiChat } from '../../../api/types';
import type { ActionReturnType } from '../../types';
import { MAIN_THREAD_ID } from '../../../api/types';

import { ARCHIVED_FOLDER_ID, MAX_ACTIVE_PINNED_CHATS } from '../../../config';
import { buildCollectionByKey, omit } from '../../../util/iteratees';
import { isLocalMessageId } from '../../../util/keys/messageKey';
import { closeMessageNotifications, notifyAboutMessage } from '../../../util/notifications';
import {
  addActionHandler, getGlobal, setGlobal,
} from '../../index';
import {
  addChatListIds,
  addUnreadMentions,
  leaveChat,
  updateChat,
  updateChatFullInfo,
  updateChatListType,
  updateChatParticipantRank,
  updatePeerStoriesHidden,
} from '../../reducers';
import { updateTabState } from '../../reducers/tabs';
import { addUnreadMessageToCounter, replaceThreadLocalStateParam } from '../../reducers/threads';
import {
  selectChat,
  selectChatFullInfo,
  selectChatListType,
  selectIsChatListed,
  selectTabState,
} from '../../selectors';
import { selectThreadLocalStateParam, selectThreadReadState } from '../../selectors/threads';

const TYPING_STATUS_CLEAR_DELAY = 6000; // 6 seconds
// Actions of Signal messages that count as unread, as the engine counts them: the other actions are notices (timers,
// group changes, calls, pins, safety numbers), which the engine stores as read
const UNREAD_ACTION_TYPES = new Set<string>(['viewOnce', 'giftBadge', 'payment']);
const INVALIDATE_FULL_CHAT_FIELDS = new Set<keyof ApiChat>([
  'restrictionReasons', 'isJoinRequest', 'type',
]);

addActionHandler('apiUpdate', (global, actions, update): ActionReturnType => {
  switch (update['@type']) {
    case 'updateChat': {
      const localChat = selectChat(global, update.id);
      const localReadState = selectThreadReadState(global, update.id, MAIN_THREAD_ID);
      const { lastReadOutboxMessageId } = localReadState || {};
      if (update.readState?.lastReadOutboxMessageId && lastReadOutboxMessageId
        && update.readState.lastReadOutboxMessageId < lastReadOutboxMessageId) {
        update = {
          ...update,
          readState: omit(update.readState, ['lastReadOutboxMessageId']),
        };
      }
      global = updateChat(global, update.id, update.chat);

      if (localChat?.areStoriesHidden !== update.chat.areStoriesHidden) {
        global = updatePeerStoriesHidden(global, update.id, update.chat.areStoriesHidden || false);
      }

      setGlobal(global);

      const updatedChat = selectChat(global, update.id);
      if (!update.noTopChatsRequest && !selectIsChatListed(global, update.id)
        && !updatedChat?.isNotJoined) {
        // Reload top chats to update chat listing
        actions.loadTopChats();
      }

      if (update.chat.id) {
        closeMessageNotifications({
          chatId: update.chat.id,
          lastReadInboxMessageId: update.readState?.lastReadInboxMessageId,
        });
      }

      if (localChat) {
        const chatUpdate = update.chat;
        const changedFields = (Object.keys(chatUpdate) as (keyof ApiChat)[])
          .filter((key) => localChat[key] !== chatUpdate[key]);
        if (changedFields.some((key) => INVALIDATE_FULL_CHAT_FIELDS.has(key))) {
          actions.invalidateFullInfo({ peerId: update.id });
        }
      }

      return undefined;
    }

    case 'updateChatJoin': {
      const chat = selectChat(global, update.id);

      global = updateChat(global, update.id, { isNotJoined: false, isForbidden: false });

      setGlobal(global);

      if (chat) {
        actions.requestChatUpdate({ chatId: chat.id });
      }

      actions.loadFullChat({ chatId: update.id, force: true });

      if (!chat) {
        return undefined;
      }

      const listType = chat.folderId === ARCHIVED_FOLDER_ID ? 'archived' : 'active';
      global = getGlobal();
      global = addChatListIds(global, listType, [update.id]);
      setGlobal(global);

      return undefined;
    }

    case 'updateChatLeave': {
      global = leaveChat(global, update.id);
      return global;
    }

    case 'updateChatTypingStatus': {
      const {
        id, threadId = MAIN_THREAD_ID, typingStatus, peerId,
      } = update;
      const currentTypingStatusByPeerId = selectThreadLocalStateParam(global, id, threadId, 'typingStatusByPeerId');

      if (!typingStatus) {
        if (!currentTypingStatusByPeerId?.[peerId]) {
          return undefined;
        }

        const nextTypingStatusByPeerId = omit(currentTypingStatusByPeerId, [peerId]);
        global = replaceThreadLocalStateParam(
          global,
          id,
          threadId,
          'typingStatusByPeerId',
          Object.keys(nextTypingStatusByPeerId).length ? nextTypingStatusByPeerId : undefined,
        );
        setGlobal(global);

        return undefined;
      }

      const updatedTypingStatusByPeerId = currentTypingStatusByPeerId
        ? { ...currentTypingStatusByPeerId, [peerId]: typingStatus }
        : { [peerId]: typingStatus };
      global = replaceThreadLocalStateParam(global, id, threadId, 'typingStatusByPeerId', updatedTypingStatusByPeerId);
      setGlobal(global);

      setTimeout(() => {
        global = getGlobal();
        const actualTypingStatusByPeerId = selectThreadLocalStateParam(global, id, threadId, 'typingStatusByPeerId');
        const currentTypingStatus = actualTypingStatusByPeerId?.[peerId];

        if (!currentTypingStatus || typingStatus.timestamp !== currentTypingStatus.timestamp) {
          return;
        }

        const nextTypingStatusByPeerId = omit(actualTypingStatusByPeerId, [peerId]);
        global = replaceThreadLocalStateParam(
          global,
          id,
          threadId,
          'typingStatusByPeerId',
          Object.keys(nextTypingStatusByPeerId).length ? nextTypingStatusByPeerId : undefined,
        );
        setGlobal(global);
      }, TYPING_STATUS_CLEAR_DELAY);

      return undefined;
    }

    case 'newMessage': {
      const { chatId, id, message } = update;

      const isOur = message.senderId ? message.senderId === global.currentUserId : message.isOutgoing;
      if (isOur && !message.isFromScheduled) {
        return undefined;
      }

      const isLocal = isLocalMessageId(id);

      const chat = selectChat(global, chatId);
      // A new dialog needs its server mute settings and read state before notifying
      if (!isLocal && !chat?.isListed && !chat?.isNotJoined) {
        actions.loadTopChats({ messageToNotify: message });
      }

      if (!chat) {
        return undefined;
      }

      const hasMention = Boolean(message.hasUnreadMention);

      const { action } = message.content;
      if (!isLocal && (!action || UNREAD_ACTION_TYPES.has(action.type))) {
        global = addUnreadMessageToCounter(global, chatId, message);

        if (hasMention) {
          global = addUnreadMentions({
            global,
            chatId,
            ids: [id],
          });
        }
      }

      setGlobal(global);

      notifyAboutMessage({
        chat,
        message,
      });

      return undefined;
    }

    case 'updateChatFullInfo': {
      return updateChatFullInfo(global, update.id, update.fullInfo);
    }

    case 'updatePinnedChatIds': {
      const { ids, folderId } = update;
      const listType = folderId === ARCHIVED_FOLDER_ID ? 'archived' : 'active';
      if (!ids) {
        return global;
      }

      return {
        ...global,
        chats: {
          ...global.chats,
          orderedPinnedIds: {
            ...global.chats.orderedPinnedIds,
            [listType]: ids.length ? ids : undefined,
          },
        },
      };
    }

    case 'updateChatPinned': {
      const { id, isPinned } = update;
      const listType = selectChatListType(global, id);
      if (!listType) {
        return undefined;
      }

      const { [listType]: orderedPinnedIds } = global.chats.orderedPinnedIds;

      let newOrderedPinnedIds = orderedPinnedIds || [];
      if (!isPinned) {
        newOrderedPinnedIds = newOrderedPinnedIds.filter((pinnedId) => pinnedId !== id);
      } else if (!newOrderedPinnedIds.includes(id)) {
        // When moving pinned chats to archive, active ordered pinned ids don't get updated
        // (to preserve chat pinned state when it returns from archive)
        // If user already has max pinned chats, we should check for orderedIds
        // that don't point to listed chats
        if (listType === 'active' && newOrderedPinnedIds.length >= MAX_ACTIVE_PINNED_CHATS) {
          const listIds = global.chats.listIds.active;
          newOrderedPinnedIds = newOrderedPinnedIds.filter((pinnedId) => listIds && listIds.includes(pinnedId));
        }

        newOrderedPinnedIds = [id, ...newOrderedPinnedIds];
      }

      return {
        ...global,
        chats: {
          ...global.chats,
          orderedPinnedIds: {
            ...global.chats.orderedPinnedIds,
            [listType]: newOrderedPinnedIds.length ? newOrderedPinnedIds : undefined,
          },
        },
      };
    }

    case 'updateChatListType': {
      const { id, folderId } = update;

      return updateChatListType(global, id, folderId);
    }

    case 'updateChatFolder': {
      const { id, folder } = update;
      const { byId: chatFoldersById, orderedIds } = global.chatFolders;

      const isDeleted = folder === undefined;

      Object.values(global.byTabId).forEach(({ id: tabId }) => {
        const tabState = selectTabState(global, tabId);
        const isFolderActive = Object.values(chatFoldersById)[tabState.activeChatFolder - 1]?.id === id;

        if (isFolderActive) {
          global = updateTabState(global, { activeChatFolder: 0 }, tabId);
        }
      });

      const newChatFoldersById = !isDeleted ? { ...chatFoldersById, [id]: folder } : omit(chatFoldersById, [id]);
      const newOrderedIds = !isDeleted
        ? orderedIds?.includes(id) ? orderedIds : [...(orderedIds || []), id]
        : orderedIds?.filter((orderedId) => orderedId !== id);

      return {
        ...global,
        chatFolders: {
          ...global.chatFolders,
          byId: newChatFoldersById,
          orderedIds: newOrderedIds,
        },
      };
    }

    case 'updateChatFoldersOrder': {
      const { orderedIds } = update;

      return {
        ...global,
        chatFolders: {
          ...global.chatFolders,
          orderedIds,
        },
      };
    }

    case 'updateChatMembers': {
      const targetChatFullInfo = selectChatFullInfo(global, update.id);
      const { replacedMembers, addedMember, deletedMemberId } = update;
      if (!targetChatFullInfo) {
        return undefined;
      }

      let shouldUpdate = false;
      let members = targetChatFullInfo?.members
        ? [...targetChatFullInfo.members]
        : [];

      if (replacedMembers) {
        members = replacedMembers;
        shouldUpdate = true;
      } else if (addedMember) {
        if (
          !members.length
          || !members.some((m) => m.userId === addedMember.userId)
        ) {
          members.push(addedMember);
          shouldUpdate = true;
        }
      } else if (members.length && deletedMemberId) {
        const deleteIndex = members.findIndex((m) => m.userId === deletedMemberId);
        if (deleteIndex > -1) {
          members.slice(deleteIndex, 1);
          shouldUpdate = true;
        }
      }

      if (shouldUpdate) {
        const adminMembers = members.filter(({ isOwner, isAdmin }) => isOwner || isAdmin);
        // TODO Kicked members?

        global = updateChat(global, update.id, { membersCount: members.length });
        global = updateChatFullInfo(global, update.id, {
          members,
          adminMembersById: buildCollectionByKey(adminMembers, 'userId'),
        });

        return global;
      }

      return undefined;
    }

    case 'updateChatParticipantRank': {
      return updateChatParticipantRank(global, update.id, update.userId, update.rank);
    }

    case 'draftMessage': {
      const {
        chatId, threadId, draft,
      } = update;
      const chat = global.chats.byId[chatId];
      if (!chat) {
        return undefined;
      }

      global = replaceThreadLocalStateParam(global, chatId, threadId || MAIN_THREAD_ID, 'draft', draft);
      return global;
    }

    case 'updatePendingJoinRequests': {
      const { chatId, requestsPending, recentRequesterIds } = update;
      const chat = global.chats.byId[chatId];
      if (!chat) {
        return undefined;
      }

      global = updateChatFullInfo(global, chatId, {
        requestsPending,
        recentRequesterIds,
      });
      setGlobal(global);

      actions.loadChatJoinRequests({ chatId });
      return undefined;
    }
  }

  return undefined;
});
