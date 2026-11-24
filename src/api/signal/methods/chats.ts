import type { ConversationRecord } from '../../../lib/signal/db/MessageDb';
import type { ThreadReadState } from '../../../types';
import type {
  ApiChat,
  ApiDraft,
  ApiMessage,
  ApiPeer,
  ApiPeerNotifySettings,
  ApiPhoneNumberLookup,
  ApiThreadInfo,
  ApiUser,
} from '../../types';
import { MAIN_THREAD_ID } from '../../types';

import { ALL_FOLDER_ID, ARCHIVED_FOLDER_ID, MUTE_INDEFINITE_TIMESTAMP } from '../../../config';
import { CdsiError } from '../../../lib/signal/cdsi/cdsiLookup';
import { getIsConversationAccepted } from '../../../lib/signal/messages/messageRequests';
import { SyncMessage_MessageRequestResponse_Type } from '../../../lib/signal/proto/generated/SignalService_pb';
import { buildCollectionByKey } from '../../../util/iteratees';
import { GLOBAL_SEARCH_CONTACTS_LIMIT, LIMITS } from '../../../limits';
import {
  buildApiChat,
  buildGroupFullInfo,
  buildNotifySettings,
  buildThreadInfo,
  buildThreadReadState,
  getIsChatListed,
  getPinnedConversations,
} from '../builders/chats';
import { buildApiChatStyle } from '../builders/chatStyle';
import { buildApiMessage } from '../builders/messages';
import { buildApiUser, buildPeerSettings, getIsContact } from '../builders/users';
import { getCurrentAccount } from '../client';
import { db, logError, processor } from '../engine';
import { getConversationByPeerId, getPeerId } from '../peers';
import { rememberConversation, rememberReadOutbox } from '../updaters/chats';
import { sendApiUpdate } from '../updates';
import { collectShownMessages } from './messages';

// The error codes of the dialog, see `READABLE_ERROR_KEYS` in `src/util/getReadableErrorText.ts`
const PINNED_LIMIT_ERROR = 'SIGNAL_PINNED_LIMIT';
const CHAT_CHANGE_ERROR = 'SIGNAL_CHAT_CHANGE_FAILED';

// E.164: a country code and at most 15 digits in all
const E164_PATTERN = /^\+[1-9]\d{6,14}$/;

type ChatSummary = {
  chat: ApiChat;
  user?: ApiUser;
  lastMessage?: ApiMessage;
  threadInfo: ApiThreadInfo;
  readState: ThreadReadState;
  notifySettings: ApiPeerNotifySettings;
};

/**
 * The chat list from the local database. Pinned chats lead the first page in pin order; the rest follow by the
 * date of their last message, and later pages continue after the offset chat.
 */
export async function fetchChats({
  limit, offsetDate, offsetPeer, archived, withPinned,
}: {
  limit: number;
  offsetDate?: number;
  offsetId?: number;
  offsetPeer?: ApiPeer;
  archived?: boolean;
  withPinned?: boolean;
}) {
  const selfAci = getCurrentAccount()?.aci;
  if (!selfAci) return undefined;

  const listed = (await db.getConversations()).filter((conversation) => (
    getIsChatListed(conversation, selfAci) && Boolean(conversation.isArchived) === Boolean(archived)
  ));
  const pinned = getPinnedConversations(listed);
  const offsetLocalId = offsetPeer ? Math.abs(Number(offsetPeer.id)) : undefined;
  const isFirstPage = offsetDate === undefined && offsetLocalId === undefined;
  const remaining = listed
    .filter(({ pinIndex }) => pinIndex === undefined)
    .sort(compareChatOrder)
    .filter((conversation) => isFirstPage || isAfterOffset(conversation, offsetDate ?? 0, offsetLocalId ?? 0));
  const page = remaining.slice(0, limit);
  const conversations = isFirstPage ? [...pinned, ...page] : page;
  const summaries = await Promise.all(conversations.map((conversation) => buildChatSummary(conversation, selfAci)));

  const chatIds = summaries.map(({ chat }) => chat.id);
  const messages = summaries.map(({ lastMessage }) => lastMessage).filter(Boolean);
  const users = summaries.map(({ user }) => user).filter(Boolean);
  const senderUsers = await buildMissingUsers(messages.map(({ senderId }) => senderId), users, selfAci);
  const lastConversation = page[page.length - 1];

  return {
    chatIds,
    chats: summaries.map(({ chat }) => chat),
    users: [...users, ...senderUsers],
    userStatusesById: {},
    draftsById: {} as Record<string, ApiDraft>,
    threadReadStatesById: Object.fromEntries(summaries.map(({ chat, readState }) => [chat.id, readState])),
    threadInfos: summaries.map(({ threadInfo }) => threadInfo),
    orderedPinnedIds: withPinned ? pinned.map(getPeerId) : undefined,
    totalChatCount: listed.length,
    messages,
    notifyExceptionById: Object.fromEntries(summaries
      .filter(({ notifySettings }) => notifySettings.mutedUntil)
      .map(({ chat, notifySettings }) => [chat.id, notifySettings])),
    lastMessageByChatId: Object.fromEntries(summaries
      .filter(({ lastMessage }) => lastMessage)
      .map(({ chat, lastMessage }) => [chat.id, lastMessage!.id])),
    nextOffsetId: lastConversation?.lastMessageId,
    nextOffsetPeerId: lastConversation && getPeerId(lastConversation),
    nextOffsetDate: lastConversation && getChatDate(lastConversation),
    isFullyLoaded: remaining.length <= limit ? true as const : undefined,
  };
}

export async function fetchChat({
  type, user, shouldRequestUpdate,
}: {
  type: 'user' | 'self' | 'support'; user?: ApiUser; shouldRequestUpdate?: boolean;
}) {
  const selfAci = getCurrentAccount()?.aci;
  if (!selfAci || type === 'support') return undefined;

  const conversation = type === 'self' ? await db.getConversation(selfAci) : await getConversationByPeerId(user!.id);
  if (!conversation) return undefined;

  if (shouldRequestUpdate) {
    await sendChatSummary(conversation, selfAci);
  } else {
    sendChat(buildApiChat(conversation, selfAci));
  }
  return { chatId: getPeerId(conversation) };
}

/** Sends the chat with its last message, read state and mute state */
export async function requestChatUpdate({ chat }: { chat: ApiChat }) {
  const selfAci = getCurrentAccount()?.aci;
  const conversation = await getConversationByPeerId(chat.id);
  if (!selfAci || !conversation) return;

  await sendChatSummary(conversation, selfAci);
}

/** Chat folders from the storage service are not stored yet, so only the list of all chats exists */
export function fetchChatFolders() {
  return Promise.resolve({
    byId: {},
    orderedIds: [ALL_FOLDER_ID],
  });
}

/** Group details and members; private chats use `fetchFullUser` */
export async function fetchFullChat(chat: ApiChat) {
  const selfAci = getCurrentAccount()?.aci;
  const conversation = await getConversationByPeerId(chat.id);
  if (!selfAci || conversation?.type !== 'group') return undefined;

  const { fullInfo, users } = await buildGroupFullInfo(conversation, selfAci);
  sendApiUpdate({ '@type': 'updateEntities', users: buildCollectionByKey(users, 'id') });
  return {
    fullInfo: { ...fullInfo, signalChatStyle: await buildApiChatStyle(conversation) },
    chats: [],
    userStatusesById: {},
    membersCount: conversation.memberAcis?.length,
  };
}

export async function fetchPeerSettings(peer: ApiPeer) {
  const selfAci = getCurrentAccount()?.aci;
  const conversation = await getConversationByPeerId(peer.id);
  return selfAci && conversation ? { settings: buildPeerSettings(conversation, selfAci) } : undefined;
}

/** Closing the bar of a message request accepts it */
export async function hidePeerSettingsBar(peer: ApiPeer) {
  const conversation = await getConversationByPeerId(peer.id);
  if (!conversation) return undefined;

  try {
    await processor.respondToMessageRequest(conversation.id, SyncMessage_MessageRequestResponse_Type.ACCEPT);
    return true;
  } catch (err) {
    logError(err);
    return undefined;
  }
}

/**
 * Deletes the chat's messages on this device and on our other devices. A message request is deleted as a
 * response to it, as Signal Desktop does from the request bar. A failed deletion keeps the chat and says so.
 */
export async function deleteHistory({ chat }: { chat: ApiChat; shouldDeleteForAll?: boolean; maxId?: number }) {
  const selfAci = getCurrentAccount()?.aci;
  const conversation = await getConversationByPeerId(chat.id);
  if (!selfAci || !conversation) {
    sendApiUpdate({ '@type': 'error', error: { message: CHAT_CHANGE_ERROR, hasErrorKey: true } });
    return undefined;
  }

  try {
    if (getIsConversationAccepted(conversation, selfAci)) {
      await processor.deleteConversation(conversation.id);
    } else {
      await processor.respondToMessageRequest(conversation.id, SyncMessage_MessageRequestResponse_Type.DELETE);
    }
  } catch (err) {
    logError(err);
    sendApiUpdate({ '@type': 'error', error: { message: CHAT_CHANGE_ERROR, hasErrorKey: true } });
    return undefined;
  }
  sendApiUpdate({ '@type': 'deleteHistory', chatId: chat.id });
  return true as const;
}

/**
 * Searches listed chats and contacts by name, username and phone number, like the conversation search of
 * Signal Desktop. It never asks the server: a user who is no chat or contact is found by `getChatByUsername` or
 * `lookUpPhoneNumber`, which run for a username or number that the user chose from the results.
 */
export async function searchChats({ query }: { query: string }) {
  const selfAci = getCurrentAccount()?.aci;
  const normalizedQuery = query.trim().toLowerCase();
  if (!selfAci || !normalizedQuery) return undefined;

  const found = (await db.getConversations())
    .filter((conversation) => (
      (getIsChatListed(conversation, selfAci) || getIsContact(conversation, selfAci))
      && getSearchTexts(conversation).some((text) => text.toLowerCase().includes(normalizedQuery))
    ))
    .sort(compareChatOrder)
    .slice(0, GLOBAL_SEARCH_CONTACTS_LIMIT);

  const users = found
    .filter(({ type }) => type === 'private')
    .map((conversation) => buildApiUser(conversation, selfAci));
  const chats = found.map((conversation) => buildApiChat(conversation, selfAci));
  sendApiUpdate({
    '@type': 'updateEntities',
    users: buildCollectionByKey(users, 'id'),
    chats: buildCollectionByKey(chats, 'id'),
  });

  return {
    accountResultIds: chats.map(({ id }) => id),
    globalResultIds: [],
  };
}

/**
 * Finds the Signal user of a phone number, from the local chats or the contact discovery service. Each new number
 * counts against the server's lookup rate limit, so this runs for a number the user chose, not while typing.
 */
export async function lookUpPhoneNumber(phoneNumber: string): Promise<ApiPhoneNumberLookup | undefined> {
  const selfAci = getCurrentAccount()?.aci;
  const e164 = `+${phoneNumber.replace(/\D/g, '')}`;
  if (!selfAci) return undefined;
  if (!E164_PATTERN.test(e164)) return { error: 'notFound' };

  try {
    const conversation = await processor.lookUpPhoneNumber(e164);
    if (!conversation) return { error: 'notFound' };
    return { chat: buildApiChat(conversation, selfAci), user: buildApiUser(conversation, selfAci) };
  } catch (err) {
    if (err instanceof CdsiError && err.reason === 'rateLimited') return { error: 'rateLimited' };
    logError(err);
    return { error: 'unavailable' };
  }
}

/**
 * Pins append to the end and bring the chat out of the archive, as in Signal Desktop
 * (`ts/models/conversations.preload.ts`, `pin`). Other devices learn about pins through the storage service. Pins
 * of conversations that only other devices have count toward the limit; at the limit the chat stays unpinned and
 * the result is `undefined`.
 */
export async function toggleChatPinned({ chat, shouldBePinned }: { chat: ApiChat; shouldBePinned: boolean }) {
  const conversation = await getConversationByPeerId(chat.id);
  if (!conversation) return undefined;
  if ((conversation.pinIndex !== undefined) === shouldBePinned) return true as const;

  if (!shouldBePinned) {
    await processor.updateConversationState(conversation.id, { pinIndex: undefined });
    return true as const;
  }

  if (await processor.countPinnedConversations() >= LIMITS.dialogFolderPinned) {
    sendApiUpdate({ '@type': 'error', error: { message: PINNED_LIMIT_ERROR, hasErrorKey: true } });
    return undefined;
  }

  const pinned = getPinnedConversations(await db.getConversations());
  await processor.updateConversationState(conversation.id, {
    pinIndex: pinned.length ? pinned[pinned.length - 1].pinIndex! + 1 : 0,
    isArchived: false,
  });
  return true as const;
}

/** Archiving unpins the chat, as in Signal Desktop (`ts/models/conversations.preload.ts`, `setArchived`) */
export async function toggleChatArchived({ chat, folderId }: { chat: ApiChat; folderId: number }) {
  const conversation = await getConversationByPeerId(chat.id);
  if (!conversation) return undefined;

  const isArchived = folderId === ARCHIVED_FOLDER_ID;
  await processor.updateConversationState(conversation.id, {
    isArchived,
    pinIndex: isArchived ? undefined : conversation.pinIndex,
  });
  return true as const;
}

/** Only the mute time exists in Signal; other notification settings stay on this device */
export async function updateChatNotifySettings({
  chat, settings,
}: {
  chat: ApiChat; settings: Partial<ApiPeerNotifySettings>;
}) {
  const conversation = await getConversationByPeerId(chat.id);
  if (!conversation || !('mutedUntil' in settings)) return;

  await processor.updateConversationState(conversation.id, { mutedUntil: getMutedUntilMs(settings.mutedUntil) });
}

export async function toggleDialogUnread({ chat, hasUnreadMark }: { chat: ApiChat; hasUnreadMark?: true }) {
  const conversation = await getConversationByPeerId(chat.id);
  if (!conversation) return;

  await processor.updateConversationState(conversation.id, { isMarkedUnread: Boolean(hasUnreadMark) });
}

async function sendChatSummary(conversation: ConversationRecord, selfAci: string) {
  const {
    chat, user, lastMessage, threadInfo, readState, notifySettings,
  } = await buildChatSummary(conversation, selfAci);

  if (user) sendApiUpdate({ '@type': 'updateUser', id: user.id, user });
  sendApiUpdate({ '@type': 'updateThreadInfo', threadInfo });
  sendApiUpdate({
    '@type': 'updateThreadReadState', chatId: chat.id, threadId: MAIN_THREAD_ID, readState,
  });
  sendChat(chat);
  if (lastMessage) sendApiUpdate({ '@type': 'updateChatLastMessage', id: chat.id, lastMessage });
  sendApiUpdate({ '@type': 'updateChatNotifySettings', chatId: chat.id, settings: notifySettings });
}

function sendChat(chat: ApiChat) {
  sendApiUpdate({
    '@type': 'updateChat', id: chat.id, chat, noTopChatsRequest: !chat.isListed,
  });
}

/** Builds what the chat list shows of a conversation and remembers it for later updates */
async function buildChatSummary(conversation: ConversationRecord, selfAci: string): Promise<ChatSummary> {
  const chat = buildApiChat(conversation, selfAci);
  const [lastMessageRecord] = await collectShownMessages(conversation.id, Number.MAX_SAFE_INTEGER, 1, false);
  const lastMessage = lastMessageRecord && await buildApiMessage(lastMessageRecord, conversation);
  const readState = await buildThreadReadState(conversation);

  rememberConversation(conversation);
  rememberReadOutbox(chat.id, readState.lastReadOutboxMessageId);

  return {
    chat,
    user: conversation.type === 'private' ? buildApiUser(conversation, selfAci) : undefined,
    lastMessage,
    threadInfo: buildThreadInfo(chat.id, lastMessage?.id),
    readState,
    notifySettings: buildNotifySettings(conversation),
  };
}

/** Users the chat list refers to without listing their chats, such as authors of group messages */
async function buildMissingUsers(userIds: (string | undefined)[], users: ApiUser[], selfAci: string) {
  const knownIds = new Set(users.map(({ id }) => id));
  const missing: ApiUser[] = [];
  for (const userId of new Set(userIds)) {
    if (!userId || knownIds.has(userId)) continue;
    const conversation = await getConversationByPeerId(userId);
    if (conversation) missing.push(buildApiUser(conversation, selfAci));
  }
  return missing;
}

/** Newest first by the date of the last message, then by creation */
function compareChatOrder(a: ConversationRecord, b: ConversationRecord) {
  return getChatDate(b) - getChatDate(a) || b.localId - a.localId;
}

function isAfterOffset(conversation: ConversationRecord, offsetDate: number, offsetLocalId: number) {
  const date = getChatDate(conversation);
  return date < offsetDate || (date === offsetDate && conversation.localId < offsetLocalId);
}

function getChatDate(conversation: ConversationRecord) {
  return Math.floor((conversation.lastMessageAt ?? 0) / 1000);
}

function getSearchTexts(conversation: ConversationRecord) {
  return [
    conversation.title,
    conversation.nickname,
    conversation.systemName,
    [conversation.profileName, conversation.profileFamilyName].filter(Boolean).join(' '),
    conversation.username,
    conversation.e164,
  ].filter(Boolean);
}

/** Signal mutes forever with `Number.MAX_SAFE_INTEGER` (Signal Desktop `packages/types/src/service/MuteExpiration.std.ts`) */
function getMutedUntilMs(mutedUntil?: number) {
  if (!mutedUntil) return undefined;
  return mutedUntil >= MUTE_INDEFINITE_TIMESTAMP ? Number.MAX_SAFE_INTEGER : mutedUntil * 1000;
}
