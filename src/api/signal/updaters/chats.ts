import type { ConversationRecord, MessageRecord } from '../../../lib/signal/db/MessageDb';
import type { MessageChanges } from '../../../lib/signal/messages/MessageProcessor';
import { MAIN_THREAD_ID } from '../../types';

import { ALL_FOLDER_ID, ARCHIVED_FOLDER_ID } from '../../../config';
import { getActivePinnedMessages } from '../../../lib/signal/messages/pinnedMessages';
import { areDeepEqual } from '../../../util/areDeepEqual';
import { buildCollectionByKey, pick } from '../../../util/iteratees';
import { getServerTime } from '../../../util/serverTime';
import {
  buildApiChat,
  buildGroupFullInfo,
  buildNotifySettings,
  buildThreadReadState,
  getIsChatListed,
  getIsReadByRecipient,
  getPinnedConversations,
} from '../builders/chats';
import { buildApiUser, buildApiUserFullInfo, buildPeerSettings } from '../builders/users';
import { getCurrentAccount } from '../client';
import { db } from '../engine';
import { getPeerId } from '../peers';
import { sendApiUpdate } from '../updates';

const MAX_TIMEOUT_MS = 2 ** 31 - 1;
const GROUP_FULL_INFO_FIELDS: (keyof ConversationRecord)[] = [
  'description', 'memberAcis', 'adminAcis', 'expireTimer', 'groupState',
];

// Conversations as the app last received them, so that only changes are sent
const reportedConversations = new Map<string, ConversationRecord>();
// The newest outgoing message a recipient read, by chat id
const lastReadOutboxIds = new Map<string, number>();
const unmuteTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pinExpiryTimers = new Map<string, ReturnType<typeof setTimeout>>();
let queue = Promise.resolve();

/**
 * Sends what changed in conversations: users, chats, list type, pins, mute, read state and full info.
 * Unread counts that grow come from `newMessage` updates, which the app counts itself; counts that drop
 * (reads here or on other devices) are sent in full. Batches are handled in order, so a later state always
 * arrives last.
 */
export function handleChatChanges(changes: MessageChanges) {
  const result = queue.then(() => applyChatChanges(changes));
  queue = result.catch(() => undefined);
  return result;
}

/** Remembers conversations the app received from a method, such as the chat list */
export function rememberConversation(conversation: ConversationRecord) {
  reportedConversations.set(conversation.id, conversation);
  scheduleUnmute(conversation);
  schedulePinExpiry(conversation);
}

export function rememberReadOutbox(chatId: string, lastReadOutboxMessageId?: number) {
  if (lastReadOutboxMessageId) lastReadOutboxIds.set(chatId, lastReadOutboxMessageId);
}

async function applyChatChanges({ conversations, messages }: MessageChanges) {
  const selfAci = getCurrentAccount()?.aci;
  if (!selfAci) return;

  let hasPinChanges = false;
  for (const conversation of conversations) {
    const previous = reportedConversations.get(conversation.id);
    rememberConversation(conversation);
    hasPinChanges ||= previous?.pinIndex !== conversation.pinIndex || (
      conversation.pinIndex !== undefined && Boolean(previous?.isArchived) !== Boolean(conversation.isArchived)
    );
    await sendConversationChanges(conversation, previous, selfAci);
  }

  if (hasPinChanges) await sendPinnedChatIds();
  await sendReadOutboxChanges(messages);
}

async function sendConversationChanges(
  conversation: ConversationRecord, previous: ConversationRecord | undefined, selfAci: string,
) {
  const id = getPeerId(conversation);
  const isPrivate = conversation.type === 'private';

  if (isPrivate) {
    const user = buildApiUser(conversation, selfAci);
    if (!previous || !areDeepEqual(user, buildApiUser(previous, selfAci))) {
      sendApiUpdate({ '@type': 'updateUser', id, user });
    }
  }

  // The app keeps chats of listed conversations; others, such as group members, stay users. A chat that leaves
  // the list is sent once more with `isListed` off
  const chat = buildApiChat(conversation, selfAci);
  const wasListed = previous && getIsChatListed(previous, selfAci);
  if ((chat.isListed || wasListed) && (!previous || !areDeepEqual(chat, buildApiChat(previous, selfAci)))) {
    sendApiUpdate({
      '@type': 'updateChat', id, chat, noTopChatsRequest: !chat.isListed,
    });
  }

  // A new listed chat makes the app request the chat list, which brings the rest
  if (!previous) return;

  if (chat.isListed && Boolean(previous.isArchived) !== Boolean(conversation.isArchived)) {
    sendApiUpdate({ '@type': 'updateChatListType', id, folderId: chat.folderId ?? ALL_FOLDER_ID });
  }

  sendPinnedMessageChanges(id, previous, conversation);

  if (previous.mutedUntil !== conversation.mutedUntil) {
    sendApiUpdate({ '@type': 'updateChatNotifySettings', chatId: id, settings: buildNotifySettings(conversation) });
  }

  if (conversation.unreadCount < previous.unreadCount
    || Boolean(conversation.isMarkedUnread) !== Boolean(previous.isMarkedUnread)) {
    const { unreadCount, hasUnreadMark, lastReadInboxMessageId } = await buildThreadReadState(conversation);
    sendApiUpdate({
      '@type': 'updateThreadReadState',
      chatId: id,
      threadId: MAIN_THREAD_ID,
      readState: { unreadCount, hasUnreadMark, lastReadInboxMessageId },
    });
  }

  if (isPrivate) {
    const fullInfo = buildApiUserFullInfo(conversation, selfAci);
    if (!areDeepEqual(fullInfo, buildApiUserFullInfo(previous, selfAci))) {
      sendApiUpdate({ '@type': 'updateUserFullInfo', id, fullInfo });
    }
  } else {
    if (!areDeepEqual(pick(previous, GROUP_FULL_INFO_FIELDS), pick(conversation, GROUP_FULL_INFO_FIELDS))) {
      const { fullInfo, users } = await buildGroupFullInfo(conversation, selfAci);
      sendApiUpdate({ '@type': 'updateEntities', users: buildCollectionByKey(users, 'id') });
      sendApiUpdate({ '@type': 'updateChatFullInfo', id, fullInfo });
      // Join requests reach admins through their own update, which reloads the list of requests
      if (getRequesterAcis(previous) !== getRequesterAcis(conversation)) {
        sendApiUpdate({
          '@type': 'updatePendingJoinRequests',
          chatId: id,
          requestsPending: fullInfo.requestsPending ?? 0,
          recentRequesterIds: fullInfo.recentRequesterIds ?? [],
        });
      }
    }
    const settings = buildPeerSettings(conversation, selfAci);
    if (!areDeepEqual(settings, buildPeerSettings(previous, selfAci))) {
      sendApiUpdate({ '@type': 'updateChatFullInfo', id, fullInfo: { settings } });
    }
  }

  if (Boolean(previous.isBlocked) !== Boolean(conversation.isBlocked)) {
    sendApiUpdate({ '@type': 'updatePeerBlocked', id, isBlocked: Boolean(conversation.isBlocked) });
  }
}

/** Messages pinned and unpinned since the app last received the conversation */
function sendPinnedMessageChanges(chatId: string, previous: ConversationRecord, conversation: ConversationRecord) {
  const now = Date.now();
  const previousIds = getActivePinnedMessages(previous, now).map(({ messageId }) => messageId);
  const currentIds = getActivePinnedMessages(conversation, now).map(({ messageId }) => messageId);
  const pinnedIds = currentIds.filter((id) => !previousIds.includes(id));
  const unpinnedIds = previousIds.filter((id) => !currentIds.includes(id));
  if (pinnedIds.length) {
    sendApiUpdate({
      '@type': 'updatePinnedIds', chatId, isPinned: true, messageIds: pinnedIds,
    });
  }
  if (unpinnedIds.length) {
    sendApiUpdate({ '@type': 'updatePinnedIds', chatId, messageIds: unpinnedIds });
  }
}

async function sendPinnedChatIds() {
  const pinned = getPinnedConversations(await db.getConversations());
  sendApiUpdate({
    '@type': 'updatePinnedChatIds',
    ids: pinned.filter(({ isArchived }) => !isArchived).map(getPeerId),
  });
  sendApiUpdate({
    '@type': 'updatePinnedChatIds',
    ids: pinned.filter(({ isArchived }) => isArchived).map(getPeerId),
    folderId: ARCHIVED_FOLDER_ID,
  });
}

/** Read receipts change messages only; the app shows outgoing messages up to `lastReadOutboxMessageId` as read */
async function sendReadOutboxChanges(messages: MessageRecord[]) {
  const readIdByConversationId = new Map<string, number>();
  for (const message of messages) {
    if (!getIsReadByRecipient(message)) continue;
    const { conversationId, id } = message;
    readIdByConversationId.set(conversationId, Math.max(id, readIdByConversationId.get(conversationId) ?? 0));
  }

  for (const [conversationId, messageId] of readIdByConversationId) {
    const conversation = reportedConversations.get(conversationId) ?? await db.getConversation(conversationId);
    if (!conversation) continue;
    const chatId = getPeerId(conversation);
    if (messageId <= (lastReadOutboxIds.get(chatId) ?? 0)) continue;

    lastReadOutboxIds.set(chatId, messageId);
    sendApiUpdate({
      '@type': 'updateThreadReadState',
      chatId,
      threadId: MAIN_THREAD_ID,
      readState: { lastReadOutboxMessageId: messageId },
    });
  }
}

function getRequesterAcis({ groupState }: ConversationRecord) {
  return groupState?.requestingMembers.map(({ aci }) => aci).join() ?? '';
}

/** Tells the app when a mute ends, so the chat list stops showing it as muted */
/**
 * Unpins the pins of a conversation as they expire, while the app runs (Signal Desktop
 * `ts/services/expiring/pinnedMessagesCleanupService.preload.ts`); later reads leave expired pins out
 */
function schedulePinExpiry(conversation: ConversationRecord) {
  const chatId = getPeerId(conversation);
  clearTimeout(pinExpiryTimers.get(chatId));
  pinExpiryTimers.delete(chatId);

  const now = Date.now();
  const expiries = getActivePinnedMessages(conversation, now)
    .map(({ expiresAt }) => expiresAt)
    .filter((expiresAt): expiresAt is number => expiresAt !== undefined);
  if (!expiries.length) return;
  const nextExpiresAt = Math.min(...expiries);
  const delay = nextExpiresAt - now;
  if (delay > MAX_TIMEOUT_MS) return;
  pinExpiryTimers.set(chatId, setTimeout(() => {
    pinExpiryTimers.delete(chatId);
    const messageIds = conversation.pinnedMessages!
      .filter(({ expiresAt }) => expiresAt === nextExpiresAt)
      .map(({ messageId }) => messageId);
    sendApiUpdate({ '@type': 'updatePinnedIds', chatId, messageIds });
    schedulePinExpiry(conversation);
  }, delay));
}

function scheduleUnmute(conversation: ConversationRecord) {
  const chatId = getPeerId(conversation);
  clearTimeout(unmuteTimers.get(chatId));
  unmuteTimers.delete(chatId);

  const delay = (conversation.mutedUntil ?? 0) - getServerTime() * 1000;
  if (delay <= 0 || delay > MAX_TIMEOUT_MS) return;
  unmuteTimers.set(chatId, setTimeout(() => {
    unmuteTimers.delete(chatId);
    sendApiUpdate({ '@type': 'updateChatNotifySettings', chatId, settings: {} });
  }, delay));
}
