import type { MessageInitShape } from '@bufbuild/protobuf';
import { fromBinary } from '@bufbuild/protobuf';

import type { ConversationRecord, MessageRecord } from '../../../lib/signal/db/MessageDb';
import type { MessageChanges } from '../../../lib/signal/messages/MessageProcessor';
import type { AttachmentPointer, DataMessage_QuoteSchema } from '../../../lib/signal/proto/generated/SignalService_pb';
import type { ForwardMessagesParams, SendMessageParams, ThreadId } from '../../../types';
import type {
  ApiAttachment,
  ApiChat,
  ApiContact,
  ApiFormattedText,
  ApiInputRichMessage,
  ApiLocalSendError,
  ApiMessage,
  ApiMessageEntity,
  ApiMessagePoll,
  ApiMessageRecipient,
  ApiMessageSearchContext,
  ApiOnProgress,
  ApiPeer,
  ApiReaction,
  ApiReplyInfo,
  ApiSendMessageAction,
  ApiSticker,
  ApiUserStatus,
  ApiWebPage,
  MediaContent,
} from '../../types';
import { ApiMessageEntityTypes, MESSAGE_DELETED } from '../../types';

import { LOCAL_MESSAGES_LIMIT, RE_LINK_TEMPLATE, SEND_MESSAGE_ACTION_INTERVAL } from '../../../config';
import { LONG_TEXT_CONTENT_TYPE } from '../../../lib/signal/messages/MessageProcessor';
import { getActivePinnedMessages } from '../../../lib/signal/messages/pinnedMessages';
import {
  DataMessage_Contact_Phone_Type, DataMessage_Quote_Type, DataMessageSchema,
} from '../../../lib/signal/proto/generated/SignalService_pb';
import { AttachmentUploadError, describeSendError, getSendErrorKind } from '../../../lib/signal/sender/sendErrors';
import { uuidToBytes } from '../../../lib/signal/serviceId';
import { fetchStickerImage } from '../../../lib/signal/stickers/stickerPacks';
import { getEmojiOnlyCountForMessage } from '../../../global/helpers/getEmojiOnlyCountForMessage';
import buildUploadingMedia from '../../../util/buildUploadingMedia';
import { bufferFromHex } from '../../../util/encoding/buffer';
import { buildCollectionByKey, omit, omitUndefined } from '../../../util/iteratees';
import { pause } from '../../../util/schedulers';
import { getServerTime } from '../../../util/serverTime';
import { buildBodyRanges, getMentionAci } from '../builders/bodyRanges';
import { getIsChatListed } from '../builders/chats';
import { buildMessageMedia, parseAttachmentMediaId } from '../builders/media';
import {
  buildApiMessageWithPoll, createUserResolver, getIsMessageHidden,
} from '../builders/messages';
import { parsePackStickerId, STICKER_SIZE } from '../builders/stickers';
import { getCurrentAccount } from '../client';
import { db, logError, processor } from '../engine';
import { uploadMessageAttachment } from '../media';
import { forgetDownloadedAttachments } from '../media/attachments';
import { getConversationByPeerId, getPeerId, getUserPeerId } from '../peers';
import { trackLocalMessage } from '../updaters/messages';
import { sendApiUpdate } from '../updates';
import { addRecentSticker } from './stickers';

type DataMessageInit = MessageInitShape<typeof DataMessageSchema>;

type OutgoingTyping = {
  refreshTimer: ReturnType<typeof setInterval>;
  pauseTimer: ReturnType<typeof setTimeout>;
};

type AttachmentPointerInit = NonNullable<DataMessageInit['attachments']>[number];

/** A photo or video of an album, which the composer sends as one call per item with a shared `groupedId` */
type AlbumItem = {
  params: SendMessageParams;
  localMessage?: ApiMessage;
  pointer?: AttachmentPointerInit;
  isSettled?: true;
};

// Signal Desktop `ts/util/longAttachment.std.ts`: longer bodies travel whole in a text attachment
const MAX_MESSAGE_BODY_BYTES = 2 * 1024;
// Signal Desktop `ts/models/conversations.preload.ts` (`bumpTyping`): a started indicator is repeated every 10 s
// and stopped 3 s after the last keystroke. The composer reports typing at most every
// `SEND_MESSAGE_ACTION_INTERVAL`, so the pause allows for that.
const TYPING_REFRESH_MS = 10 * 1000;
const TYPING_PAUSE_MS = 3 * 1000 + SEND_MESSAGE_ACTION_INTERVAL;
const SEND_ERROR = 'SIGNAL_SEND_FAILED';
const EDIT_ERROR = 'MESSAGE_EDIT_TIME_EXPIRED';
const DELETE_ERROR = 'MESSAGE_DELETE_FORBIDDEN';

let localMessageCounter = 0;
const outgoingTypingByConversationId = new Map<string, OutgoingTyping>();
// Items of albums being uploaded, by `groupedId`
const albumItemsByGroupedId = new Map<string, AlbumItem[]>();

/**
 * History pages with the paging of Telegram's `messages.getHistory`: messages before `offsetId`, newest first,
 * shifted toward newer ones by a negative `addOffset`. Message ids grow in arrival order across conversations.
 */
export async function fetchMessages({
  chat, offsetId, addOffset = 0, limit,
}: {
  chat: ApiChat;
  offsetId?: number;
  addOffset?: number;
  limit: number;
}) {
  const conversation = await getConversationByPeerId(chat.id);
  if (!conversation) return undefined;

  const fromId = offsetId || Number.MAX_SAFE_INTEGER;
  const newerCount = Math.max(-addOffset, 0);
  const olderSkip = Math.max(addOffset, 0);
  const newer = newerCount ? await collectShownMessages(conversation.id, fromId, newerCount, true) : [];
  const older = await collectShownMessages(conversation.id, fromId, limit - newerCount + olderSkip, false);
  const records = [...newer.reverse(), ...older.slice(olderSkip)];

  const { messages, users } = await buildMessages(records, conversation);
  return {
    messages,
    users,
    chats: [],
    count: await db.countMessages(conversation.id),
  };
}

/** The unread messages of a chat that mention someone, built, of which those that mention us count */
export async function fetchUnreadMentions({ chat }: { chat: ApiChat }) {
  const conversation = await getConversationByPeerId(chat.id);
  if (!conversation) return undefined;

  // Only messages with a mention are built
  const records = (await db.getUnreadMessages(conversation.id)).filter((record) => (
    record.dataMessage && !getIsMessageHidden(record)
    && fromBinary(DataMessageSchema, record.dataMessage).bodyRanges.some((range) => getMentionAci(range))
  ));
  const { messages, users } = await buildMessages(records, conversation);
  return { messages: messages.filter(({ hasUnreadMention }) => hasUnreadMention), users };
}

export async function fetchMessage({ chat, messageId }: { chat: ApiChat; messageId: number }) {
  const conversation = await getConversationByPeerId(chat.id);
  if (!conversation) return undefined;
  const record = await db.getMessage(messageId);
  if (!record || record.conversationId !== conversation.id || getIsMessageHidden(record)) return MESSAGE_DELETED;
  const { messages: [message] } = await buildMessages([record], conversation);
  return { message };
}

export async function fetchMessagesById({ chat, messageIds }: { chat: ApiChat; messageIds: number[] }) {
  const conversation = await getConversationByPeerId(chat.id);
  if (!conversation) return undefined;
  const records = await Promise.all(messageIds.map((id) => db.getMessage(id)));
  const shown = records.filter((record): record is MessageRecord => (
    record?.conversationId === conversation.id && !getIsMessageHidden(record)
  ));
  return (await buildMessages(shown, conversation)).messages;
}

type SearchMessagesResult = {
  messages: ApiMessage[];
  totalCount: number;
  nextOffsetId?: number;
  nextOffsetRate?: number;
  nextOffsetPeerId?: string;
  userStatusesById: Record<string, ApiUserStatus>;
};

const EMPTY_SEARCH_RESULT: SearchMessagesResult = { messages: [], totalCount: 0, userStatusesById: {} };

/**
 * Messages of a chat of the search type whose text contains `query`, newest first, around `offsetId`, and only those
 * of `fromPeer` when it is set. As in Telegram's search, the page is the window of `limit` matches that starts
 * `addOffset` matches from `offsetId`: a negative `addOffset` reaches past it to newer matches, the match at `offsetId`
 * itself being the last of them, as the media viewer asks for the items around the open one. The shared media types
 * (`SHARED_MEDIA_SEARCH_TYPES`) and a sender search take an empty query. Signal keeps no search index, so the stored
 * messages are read; a search whose query a newer query replaced resolves to `undefined` (`latestQueriesBySearchKey`).
 */
export async function searchMessagesInChat({
  peer, type, query = '', limit, offsetId, addOffset = 0, fromPeer,
}: {
  peer: ApiPeer;
  type: string;
  query?: string;
  limit: number;
  offsetId?: number;
  addOffset?: number;
  threadId?: ThreadId;
  fromPeer?: ApiPeer;
  minDate?: number;
  maxDate?: number;
}): Promise<SearchMessagesResult | undefined> {
  if (!getIsSearchSupported(type, query, Boolean(fromPeer))) return EMPTY_SEARCH_RESULT;

  const conversation = await getConversationByPeerId(peer.id);
  // A sender filter names a user, whose conversation id is the ACI of the user's messages
  const senderConversation = fromPeer ? await getConversationByPeerId(fromPeer.id) : undefined;
  if (!conversation || (fromPeer && !senderConversation)) return EMPTY_SEARCH_RESULT;

  const filter: SearchFilter = { type, needle: query.toLowerCase(), senderAci: senderConversation?.id };
  const run = startSearch(conversation.id, filter);
  try {
    return await searchChatWindow(conversation, filter, limit, addOffset, run, offsetId);
  } finally {
    endSearch(run);
  }
}

/** The window of `limit` matches of a chat around `offsetId`, see `searchMessagesInChat` */
async function searchChatWindow(
  conversation: ConversationRecord,
  filter: SearchFilter,
  limit: number,
  addOffset: number,
  run?: SearchRun,
  offsetId?: number,
) {
  // The window's positions run from `addOffset` on: below -1 the matches newer than `offsetId`, -1 the match at
  // `offsetId`, and from 0 the older ones
  const start = offsetId ? Math.min(addOffset, 0) : 0;
  const end = start + limit;
  const newerCount = Math.min(-start - 1, limit);
  const newer = newerCount > 0
    ? await scanNewerMatches(conversation, filter, offsetId! + 1, newerCount, run)
    : [];
  if (!newer) return undefined;
  const offsetRecord = start <= -1 && end > -1 ? await db.getMessage(offsetId!) : undefined;
  const offsetMatch = offsetRecord?.conversationId === conversation.id && getIsFilterMatch(offsetRecord, filter)
    ? [offsetRecord]
    : [];
  const older = end > 0
    ? await scanMessages({
      scope: conversation.id, conversations: [conversation], filter, limit: end, offsetId, run,
    })
    : { matches: [], matchCount: 0 };
  if (!older) return undefined;
  return buildSearchResult({
    matches: [...newer, ...offsetMatch].map((record) => ({ record, conversation })).concat(older.matches),
    matchCount: older.matchCount + newer.length + offsetMatch.length,
    cursor: older.cursor,
  });
}

/**
 * Messages of every listed chat of the search type whose text contains `query`, newest first, from before `offsetId`;
 * the `nextOffsetId` of a result continues the search with the next page.
 */
export async function searchMessagesGlobal({
  type, query = '', limit, offsetId,
}: {
  type: string;
  query?: string;
  limit: number;
  offsetId?: number;
  addOffset?: number;
  offsetRate?: number;
  offsetPeer?: ApiPeer;
  context?: ApiMessageSearchContext;
  minDate?: number;
  maxDate?: number;
}): Promise<SearchMessagesResult | undefined> {
  const selfAci = getCurrentAccount()?.aci;
  if (!selfAci || !getIsSearchSupported(type, query)) return EMPTY_SEARCH_RESULT;

  const conversations = (await db.getConversations()).filter((conversation) => (
    getIsChatListed(conversation, selfAci)
  ));
  const filter: SearchFilter = { type, needle: query.toLowerCase() };
  const run = startSearch(GLOBAL_SEARCH_SCOPE, filter);
  try {
    const scan = await scanMessages({
      scope: GLOBAL_SEARCH_SCOPE, conversations, filter, limit, offsetId, run,
    });
    return scan && await buildSearchResult(scan);
  } finally {
    endSearch(run);
  }
}

const MIN_SEARCH_QUERY_LENGTH = 2;
// The shared media of a chat: photos and videos, files, links, music and voice messages with round videos
const SHARED_MEDIA_SEARCH_TYPES = new Set<string>(['media', 'documents', 'links', 'audio', 'voice']);
const LINK_REGEX = new RegExp(RE_LINK_TEMPLATE, 'i');
const SHARED_MEDIA_COUNT_BATCH_SIZE = 200;

/** The shared media counts of each conversation, counted or being counted, until its messages change */
const sharedMediaCountsByConversationId = new Map<string, Promise<SharedMediaCounts>>();
/**
 * Records looked at before a search yields to the other work of the worker. A search with matches returns them at
 * that point with its cursor; one without goes on after the yield until it finds a match or reads every record.
 */
const SEARCH_CHUNK_SIZE = 1000;
/** Records read from a chat at a time; a chat is read only when its newest unread record is the newest of all */
const SEARCH_BATCH_SIZE = 32;
const GLOBAL_SEARCH_SCOPE = 'global';
/**
 * The latest text query of each chat or of all chats, by scope, type and sender, with how many of its searches run: a
 * search of an older query stops at its next chunk instead of reading on for a page nobody waits for. Searches of the
 * same query (pages, the loads before and after an item) and searches without a query never stop each other.
 */
const latestQueriesBySearchKey = new Map<string, { needle: string; runningCount: number }>();
/** Recent search cursors that are remembered with the count of the matches up to them */
const SEARCH_COUNTS_LIMIT = 32;

/**
 * The count of the matches up to the cursor of each recent page, by search and cursor. Clients take the count of the
 * last page for the count of all matches, so each page counts the matches of the pages before it.
 */
const searchCountsByCursorKey = new Map<string, number>();

/** What a search looks for: the type, the lower-case text and, when set, the sender */
type SearchFilter = {
  type: string;
  needle: string;
  senderAci?: string;
};

/** A chat walked by a search: the records read from it and not looked at yet, newest first */
type SearchChat = {
  conversation: ConversationRecord;
  buffer: MessageRecord[];
  // At least the id of the newest record not read yet, `undefined` once every record is read
  nextId?: number;
};

type SearchScan = {
  matches: { record: MessageRecord; conversation: ConversationRecord }[];
  // The matches of this page and the pages before it
  matchCount: number;
  cursor?: number;
};

/**
 * Whether a search has an answer: text needs a query of `MIN_SEARCH_QUERY_LENGTH`, except when it lists a sender's
 * messages, and shared media takes an empty query or one of that length
 */
function getIsSearchSupported(type: string, query: string, isSenderSearch?: boolean) {
  if (type === 'text') return query.length >= MIN_SEARCH_QUERY_LENGTH || (isSenderSearch && !query);
  return SHARED_MEDIA_SEARCH_TYPES.has(type) && (!query || query.length >= MIN_SEARCH_QUERY_LENGTH);
}

type SearchRun = { key: string; needle: string };

/** Starts a search with a query, which replaces the searches of other queries of its scope, type and sender */
function startSearch(scope: string, { type, needle, senderAci }: SearchFilter): SearchRun | undefined {
  if (!needle) return undefined;
  const key = [scope, type, senderAci ?? ''].join('\n');
  const latest = latestQueriesBySearchKey.get(key);
  if (latest?.needle === needle) {
    latest.runningCount++;
  } else {
    latestQueriesBySearchKey.set(key, { needle, runningCount: 1 });
  }
  return { key, needle };
}

/** Forgets the latest query of a search key once none of its searches runs */
function endSearch(run?: SearchRun) {
  const latest = run && latestQueriesBySearchKey.get(run.key);
  if (!latest || latest.needle !== run.needle) return;
  latest.runningCount--;
  if (!latest.runningCount) latestQueriesBySearchKey.delete(run.key);
}

function getIsSearchReplaced(run?: SearchRun) {
  return Boolean(run) && latestQueriesBySearchKey.get(run.key)?.needle !== run.needle;
}

/**
 * The matches of `filter`, newest first, from before `offsetId`. The chats are walked together, the newest record of
 * any of them next, so every record newer than the cursor has been looked at when the walk stops; a chat is read only
 * when its turn comes. The walk ends after `limit` matches, or at the end of a chunk of `SEARCH_CHUNK_SIZE` records
 * with at least one match, and it gives up with `undefined` at the end of a chunk when a newer query replaced its own.
 * `cursor` is the id to continue from, and it is `undefined` once no record is left.
 */
async function scanMessages({
  scope, conversations, filter, limit, offsetId, run,
}: {
  scope: string;
  conversations: ConversationRecord[];
  filter: SearchFilter;
  limit: number;
  offsetId?: number;
  run?: SearchRun;
}): Promise<SearchScan | undefined> {
  const searchKey = [scope, filter.type, filter.senderAci ?? '', filter.needle].join('\n');
  const nextIds = await db.getNewestMessageIds(
    conversations.map(({ id }) => id), offsetId || Number.MAX_SAFE_INTEGER,
  );
  const chats: SearchChat[] = [];
  conversations.forEach((conversation, index) => {
    const nextId = nextIds[index];
    if (nextId !== undefined) chats.push({ conversation, buffer: [], nextId });
  });

  const matches: SearchScan['matches'] = [];
  let lookedAt = 0;
  let lastRead: number | undefined;
  while (matches.length < limit) {
    const chat = getNewestSearchChat(chats);
    if (!chat) break;
    if (!chat.buffer.length) {
      await fillSearchBuffer(chat);
      continue;
    }
    if (lookedAt >= SEARCH_CHUNK_SIZE) {
      if (matches.length) break;
      lookedAt = 0;
      await pause(0);
      if (getIsSearchReplaced(run)) return undefined;
    }

    const record = chat.buffer.shift()!;
    lookedAt++;
    lastRead = record.id;
    if (getIsFilterMatch(record, filter)) matches.push({ record, conversation: chat.conversation });
  }

  const isComplete = !getNewestSearchChat(chats);
  const cursor = isComplete ? undefined : lastRead;
  const previousCount = (offsetId && searchCountsByCursorKey.get(`${searchKey}\n${offsetId}`)) || 0;
  const matchCount = previousCount + matches.length;
  if (cursor) {
    // Web K goes on from its last match, which counts the same matches as the cursor after it
    const lastMatchId = matches.length ? matches[matches.length - 1].record.id : undefined;
    rememberSearchCount(`${searchKey}\n${cursor}`, matchCount);
    if (lastMatchId) rememberSearchCount(`${searchKey}\n${lastMatchId}`, matchCount);
  }
  return { matches, matchCount, cursor };
}

/**
 * Up to `count` matches of a chat from `fromId` on, newest first, yielding after each chunk of records; `undefined`
 * when a newer query replaced its own
 */
async function scanNewerMatches(
  conversation: ConversationRecord, filter: SearchFilter, fromId: number, count: number, run?: SearchRun,
) {
  const matches: MessageRecord[] = [];
  let cursorId = fromId;
  let lookedAt = 0;
  while (matches.length < count) {
    const records = await db.getMessagesFrom(conversation.id, SEARCH_BATCH_SIZE, cursorId);
    for (const record of records) {
      if (getIsFilterMatch(record, filter)) matches.push(record);
      if (matches.length >= count) break;
    }
    if (records.length < SEARCH_BATCH_SIZE) break;
    // `getMessagesFrom` includes its bound
    cursorId = records[records.length - 1].id + 1;
    lookedAt += records.length;
    if (lookedAt >= SEARCH_CHUNK_SIZE) {
      lookedAt = 0;
      await pause(0);
      if (getIsSearchReplaced(run)) return undefined;
    }
  }
  return matches.reverse();
}

/** The chat whose next record is the newest, by the record read or the bound of the one not read yet */
function getNewestSearchChat(chats: SearchChat[]) {
  let newest: SearchChat | undefined;
  let newestId = -1;
  for (const chat of chats) {
    const id = chat.buffer.length ? chat.buffer[0].id : chat.nextId;
    if (id !== undefined && id > newestId) {
      newest = chat;
      newestId = id;
    }
  }
  return newest;
}

function getIsFilterMatch(record: MessageRecord, { type, needle, senderAci }: SearchFilter) {
  return !getIsMessageHidden(record) && (!senderAci || record.authorAci === senderAci)
    && getIsSearchMatch(record, type, needle);
}

/** Whether a message has the text of the search and, for shared media, is of its type */
function getIsSearchMatch(record: MessageRecord, type: string, needle: string) {
  if (needle && !record.body?.toLowerCase().includes(needle)) return false;
  if (type === 'text') return true;

  const kind = getSharedMediaKind(record);
  return type === 'media' ? kind.isPhoto || kind.isVideo : Boolean(kind[SHARED_MEDIA_KIND_KEYS[type]]);
}

const SHARED_MEDIA_KIND_KEYS: Record<string, keyof SharedMediaKind> = {
  documents: 'isDocument',
  links: 'isLink',
  audio: 'isAudio',
  voice: 'isVoice',
};

type SharedMediaCounts = Record<'photos' | 'videos' | 'documents' | 'links' | 'audio' | 'voice', number>;

type SharedMediaKind = {
  isPhoto?: boolean;
  isVideo?: boolean;
  isDocument?: boolean;
  isLink?: boolean;
  isAudio?: boolean;
  isVoice?: boolean;
};

/**
 * What shared media a message is: a link in its text, and its photo, video, file, music or voice; view-once media is
 * none of them
 */
function getSharedMediaKind(record: MessageRecord): SharedMediaKind {
  const isLink = Boolean(record.body && LINK_REGEX.test(record.body));
  if (!record.dataMessage) return { isLink };

  const dataMessage = fromBinary(DataMessageSchema, record.dataMessage);
  if (dataMessage.isViewOnce) return { isLink };
  const {
    photo, video, document, audio, voice,
  } = buildMessageMedia(record, dataMessage);
  return {
    isLink,
    isPhoto: Boolean(photo),
    // A GIF is in no tab, as Web K and Telegram leave GIFs out of the media tab
    isVideo: Boolean(video && !video.isRound && !video.isGif),
    isDocument: Boolean(document),
    isAudio: Boolean(audio),
    isVoice: Boolean(voice || video?.isRound),
  };
}

/**
 * How many messages of a chat are each kind of shared media, for clients that show the counts on their tabs. Signal
 * keeps no index, so the whole chat is read.
 */
export async function fetchSharedMediaCounts({ chat }: { chat: ApiChat }) {
  const conversation = await getConversationByPeerId(chat.id);
  if (!conversation) return undefined;

  let counts = sharedMediaCountsByConversationId.get(conversation.id);
  if (!counts) {
    counts = countSharedMedia(conversation.id);
    sharedMediaCountsByConversationId.set(conversation.id, counts);
    counts.catch(() => sharedMediaCountsByConversationId.delete(conversation.id));
  }
  return counts;
}

/** Forgets the shared media counts of the conversations whose messages changed */
export function forgetSharedMediaCounts({ messages, deletedMessages }: MessageChanges) {
  for (const { conversationId } of [...messages, ...deletedMessages]) {
    sharedMediaCountsByConversationId.delete(conversationId);
  }
}

async function countSharedMedia(conversationId: string) {
  const counts: Record<keyof SharedMediaKind, number> = {
    isPhoto: 0, isVideo: 0, isDocument: 0, isLink: 0, isAudio: 0, isVoice: 0,
  };
  let before = Number.MAX_SAFE_INTEGER;
  for (;;) {
    const records = await db.getMessages(conversationId, SHARED_MEDIA_COUNT_BATCH_SIZE, before);
    for (const record of records) {
      if (getIsMessageHidden(record)) continue;
      const kind = getSharedMediaKind(record);
      for (const key of Object.keys(counts) as (keyof SharedMediaKind)[]) {
        if (kind[key]) counts[key]++;
      }
    }
    if (records.length < SHARED_MEDIA_COUNT_BATCH_SIZE) break;
    before = records[records.length - 1].id;
  }
  return {
    photos: counts.isPhoto,
    videos: counts.isVideo,
    documents: counts.isDocument,
    links: counts.isLink,
    audio: counts.isAudio,
    voice: counts.isVoice,
  };
}

/** Reads the next batch of a chat's records into its empty buffer */
async function fillSearchBuffer(chat: SearchChat) {
  // `getMessages` excludes its bound
  const records = await db.getMessages(chat.conversation.id, SEARCH_BATCH_SIZE, chat.nextId! + 1);
  chat.buffer = records;
  chat.nextId = records.length === SEARCH_BATCH_SIZE ? records[records.length - 1].id - 1 : undefined;
}

function rememberSearchCount(cursorKey: string, matchCount: number) {
  searchCountsByCursorKey.set(cursorKey, matchCount);
  if (searchCountsByCursorKey.size > SEARCH_COUNTS_LIMIT) {
    searchCountsByCursorKey.delete(searchCountsByCursorKey.keys().next().value!);
  }
}

/**
 * The matches as messages. While records remain, the result names the next page and counts one match beyond the
 * loaded ones, so a client does not take the loaded matches for all of them.
 */
async function buildSearchResult({ matches, matchCount, cursor }: SearchScan): Promise<SearchMessagesResult> {
  const messages: ApiMessage[] = [];
  const byConversation = new Map<ConversationRecord, MessageRecord[]>();
  for (const { record, conversation } of matches) {
    byConversation.set(conversation, [...byConversation.get(conversation) ?? [], record]);
  }
  for (const [conversation, records] of byConversation) {
    messages.push(...(await buildMessages(records, conversation)).messages);
  }
  messages.sort((a, b) => b.id - a.id);

  return {
    messages,
    totalCount: cursor ? matchCount + 1 : matchCount,
    nextOffsetId: cursor,
    userStatusesById: {},
  };
}

/** Shows the message being sent until the stored message replaces it */
export function sendMessageLocal(params: SendMessageParams) {
  const {
    chat, lastMessageId, text, entities, replyInfo, attachment, sticker, contact, poll, groupedId, wasDrafted,
  } = params;
  if (!chat) return undefined;

  const localPoll: ApiMessagePoll | undefined = poll && { mediaType: 'poll', summary: poll.summary, results: {} };
  const media = attachment ? buildUploadingMedia(attachment) : { sticker, contact };
  return showLocalMessage(chat, lastMessageId, {
    ...media,
    text: text ? { text, entities } : undefined,
    pollId: localPoll?.summary.id,
  }, {
    replyInfo: replyInfo?.type === 'message' ? { type: 'message', replyToMsgId: replyInfo.replyToMsgId } : undefined,
    poll: localPoll,
    groupedId: getIsAlbumItem(params) ? groupedId : undefined,
    wasDrafted,
  });
}

/**
 * Sends text with formatting and mentions, a reply, an attachment, a sticker, a shared contact or a poll; content
 * Signal has no counterpart for fails. The photos and videos of an album go as one message with all of them, as Signal
 * clients send them; other grouped files go one per message.
 */
export async function sendMessage(params: SendMessageParams, onProgress?: ApiOnProgress) {
  if (params.replyInfo?.type === 'story') {
    await sendStoryReply(params);
    return;
  }

  // The composer sends the items of an album one after another, so each joins the album before its upload starts
  const albumItem = getIsAlbumItem(params) ? joinAlbum(params) : undefined;
  let localMessage: ApiMessage | undefined;
  try {
    localMessage = params.localMessage ?? await sendMessageLocal(params);
  } finally {
    // An item without a local message leaves the album, so the others are not held back
    if (albumItem && !localMessage) await settleAlbumItem(albumItem);
  }
  if (!localMessage) return;
  if (albumItem) {
    await uploadAlbumItem(albumItem, localMessage, onProgress);
    return;
  }

  const conversation = await getConversationByPeerId(localMessage.chatId);
  if (!conversation) {
    markLocalMessageFailed(localMessage);
    return;
  }
  clearOutgoingTyping(conversation.id);

  let init: DataMessageInit;
  try {
    init = await buildDataMessage(params, onProgress);
  } catch (err) {
    if (!onProgress?.isCanceled) markLocalMessageFailed(localMessage, err);
    return;
  }
  await sendWithLocalMessage(conversation, init, localMessage);
}

export async function editMessage({
  message, text, entities, richMessage, attachment,
}: {
  chat: ApiChat;
  message: ApiMessage;
  text: string;
  entities?: ApiMessageEntity[];
  richMessage?: ApiInputRichMessage;
  attachment?: ApiAttachment;
  noWebPage?: boolean;
}, onProgress?: ApiOnProgress) {
  try {
    // Signal edits change the text only
    if (richMessage || attachment) throw new Error('Only the text of a message can be edited');
    const { body, bodyRanges } = await buildOutgoingBody({ text, entities });
    const { body: inlineBody, bodyAttachment } = await prepareLongBody(body, onProgress);
    await processor.sendEditMessage(message.id, { body: inlineBody, bodyRanges, bodyAttachment });
  } catch (err) {
    logError(err);
    sendError(EDIT_ERROR);
  }
}

export async function deleteMessages({
  messageIds, shouldDeleteForAll,
}: {
  chat: ApiChat; messageIds: number[]; shouldDeleteForAll?: boolean;
}) {
  try {
    if (shouldDeleteForAll) {
      await processor.deleteForEveryone(messageIds);
    } else {
      await processor.deleteForMe(messageIds);
    }
  } catch (err) {
    logError(err);
    sendError(DELETE_ERROR);
  }
}

/** Signal keeps one reaction per person, so only the last of `reactions` counts */
export async function sendReaction({
  chat, messageId, reactions,
}: {
  chat: ApiChat;
  messageId: number;
  reactions?: ApiReaction[];
  shouldAddToRecent?: boolean;
}) {
  const conversation = await getConversationByPeerId(chat.id);
  if (!conversation) return undefined;
  const reaction = reactions?.[reactions.length - 1];
  await processor.sendReaction(messageId, reaction?.type === 'emoji' ? reaction.emoticon : undefined);
  return true;
}

/** The pinned messages of a chat that have not expired, newest pin first; Signal has no threads */
export async function fetchPinnedMessages({ chat }: { chat: ApiChat; threadId: ThreadId }) {
  const conversation = await getConversationByPeerId(chat.id);
  if (!conversation) return undefined;
  const records = await Promise.all(
    getActivePinnedMessages(conversation, Date.now()).map(({ messageId }) => db.getMessage(messageId)),
  );
  const shown = records.filter((record): record is MessageRecord => Boolean(record) && !getIsMessageHidden(record));
  return { messages: (await buildMessages(shown, conversation)).messages };
}

/**
 * Pins a message for everyone in the chat, or unpins it. Signal pins have no silent or one-sided form, so
 * `isSilent` and `isOneSide` are ignored; resolves to `undefined` when the change was not sent.
 */
export async function pinMessage({ messageId, isUnpin }: {
  chat: ApiChat;
  messageId: number;
  isUnpin: boolean;
  isOneSide?: boolean;
  isSilent?: boolean;
}) {
  try {
    await processor.sendPin(messageId, !isUnpin);
    return true;
  } catch (err) {
    logError(err);
    return undefined;
  }
}

/** Unpins every pinned message of a chat with one unpin message each; Signal has no message that unpins all */
export async function unpinAllMessages({ chat }: { chat: ApiChat; threadId?: ThreadId }) {
  const conversation = await getConversationByPeerId(chat.id);
  if (!conversation) return undefined;
  for (const { messageId } of getActivePinnedMessages(conversation, Date.now())) {
    const result = await pinMessage({ chat, messageId, isUnpin: true });
    if (!result) return undefined;
  }
  return true;
}

/** Everyone who reacted to a message, or with `reaction` only; Signal sends the full list with the message */
export async function fetchMessageReactionsList({
  chat, messageId, reaction,
}: {
  chat: ApiChat; messageId: number; reaction?: ApiReaction; offset?: string;
}) {
  const conversation = await getConversationByPeerId(chat.id);
  const record = await db.getMessage(messageId);
  if (!conversation || record?.conversationId !== conversation.id) return undefined;

  const { messages: [message] } = await buildMessages([record], conversation);
  const reactions = (message.reactions?.recentReactions ?? []).filter((peerReaction) => (
    !reaction || (reaction.type === 'emoji' && peerReaction.reaction.type === 'emoji'
      && peerReaction.reaction.emoticon === reaction.emoticon)
  ));
  return { nextOffset: undefined, reactions, count: reactions.length };
}

/** Marks incoming messages read up to `maxId`, which sends read receipts and syncs */
export async function markMessageListRead({
  chat, maxId,
}: {
  chat: ApiChat; threadId: ThreadId; maxId?: number;
}) {
  const conversation = await getConversationByPeerId(chat.id);
  if (!conversation) return;
  await processor.markRead(conversation.id, maxId || undefined).catch(logError);
}

/** Marks voice, video and view-once messages viewed after they were played or opened */
export async function markMessagesRead({ messageIds }: { chat: ApiChat; messageIds: number[] }) {
  // The attachments of view-once messages, which marking them viewed erases (see `MessageProcessor.markViewed`)
  const viewOnceAttachments: AttachmentPointer[] = [];
  for (const id of messageIds) {
    const record = await db.getMessage(id);
    const dataMessage = record?.dataMessage && fromBinary(DataMessageSchema, record.dataMessage);
    if (dataMessage && dataMessage.isViewOnce) viewOnceAttachments.push(...dataMessage.attachments);
  }
  await processor.markViewed(messageIds).catch(logError);
  forgetDownloadedAttachments(viewOnceAttachments);
}

/**
 * Typing indicators as Signal Desktop sends them: started at the first keystroke and every 10 s while typing
 * goes on, stopped after a pause or when the composer is cleared
 */
export async function sendMessageAction({
  peer, action,
}: {
  peer: ApiPeer; threadId?: ThreadId; action: ApiSendMessageAction;
}) {
  const conversation = await getConversationByPeerId(peer.id);
  if (!conversation) return undefined;
  const { id } = conversation;

  if (action.type === 'typing') {
    const current = outgoingTypingByConversationId.get(id);
    if (current) clearTimeout(current.pauseTimer);
    outgoingTypingByConversationId.set(id, {
      refreshTimer: current?.refreshTimer ?? setInterval(() => sendTyping(id, true), TYPING_REFRESH_MS),
      pauseTimer: setTimeout(() => stopOutgoingTyping(id), TYPING_PAUSE_MS),
    });
    if (!current) await sendTyping(id, true);
  } else if (action.type === 'cancel' && outgoingTypingByConversationId.has(id)) {
    await stopOutgoingTyping(id);
  }
  return undefined;
}

/** Signal polls take option indexes; an empty list takes the vote back */
export async function sendPollVote({
  messageId, options,
}: {
  chat: ApiChat; messageId: number; options: string[];
}) {
  await processor.sendPollVote(messageId, options.map(Number)).catch(logError);
}

/** Voters of a poll option from the stored votes; Signal votes carry no date, and all voters come at once */
export async function loadPollOptionResults({
  chat, messageId, option,
}: {
  chat: ApiChat; messageId: number; option?: string; offset?: string; limit?: number; shouldResetVoters?: boolean;
}) {
  const conversation = await getConversationByPeerId(chat.id);
  const record = await db.getMessage(messageId);
  if (!conversation || record?.conversationId !== conversation.id) return undefined;

  const optionIndex = Number(option);
  const voters = (record.pollVotes ?? []).filter(({ optionIndexes }) => optionIndexes.includes(optionIndex));
  // Without a date the voter list shows no vote time
  const votes = await Promise.all(voters.map(async ({ authorAci }) => ({
    peerId: await getUserPeerId(authorAci), date: 0,
  })));
  return { count: votes.length, votes, nextOffset: undefined, shouldResetVoters: undefined };
}

export async function closePoll({ messageId }: { chat: ApiChat; messageId: number; poll: ApiMessagePoll }) {
  await processor.endPoll(messageId).catch(logError);
}

/**
 * A forward is a new message with the content of the original; attachments keep their CDN pointers, which
 * recipients can download while the CDN keeps the file. Forwarded messages show no author in Signal, so their
 * local messages have no forward header
 */
export async function forwardMessages(params: ForwardMessagesParams) {
  const {
    toChat, messages, noCaptions, lastMessageId, localIds, wasDrafted,
  } = params;

  const localMessages: ApiMessage[] = [];
  for (const [index, message] of messages.entries()) {
    const hasMedia = Object.keys(omit(message.content, ['text'])).length > 0;
    const content = noCaptions && hasMedia ? omit(message.content, ['text']) : message.content;
    const localId = localIds?.[index];
    localMessages.push(await showLocalMessage(toChat, lastMessageId, content, { wasDrafted, localId }));
  }

  const conversation = await getConversationByPeerId(toChat.id);
  // The id of each forwarded message as stored, or `undefined` when it was not sent
  const storedIds: (number | undefined)[] = localMessages.map(() => undefined);
  for (const [index, localMessage] of localMessages.entries()) {
    const record = await db.getMessage(messages[index].id);
    if (!conversation || !record?.dataMessage) {
      markLocalMessageFailed(localMessage);
      continue;
    }

    const original = fromBinary(DataMessageSchema, record.dataMessage);
    const isCaptionDropped = noCaptions && original.attachments.length > 0;
    const body = isCaptionDropped ? '' : original.body;
    // Polls and other content without text, attachments, contacts or stickers are not forwarded
    if (!body && !original.attachments.length && !original.contact.length && !original.sticker) {
      markLocalMessageFailed(localMessage);
      continue;
    }

    storedIds[index] = await sendWithLocalMessage(conversation, {
      body,
      bodyRanges: isCaptionDropped ? [] : original.bodyRanges,
      attachments: original.attachments,
      contact: original.contact,
      sticker: original.sticker,
    }, localMessage);
  }
  return storedIds;
}

function getIsAlbumItem({ groupedId, attachment }: SendMessageParams) {
  if (!groupedId || !attachment) return false;
  const { photo, video } = buildUploadingMedia(attachment);
  return Boolean(photo || video);
}

function joinAlbum(params: SendMessageParams) {
  const item: AlbumItem = { params };
  const groupedId = params.groupedId!;
  albumItemsByGroupedId.set(groupedId, [...albumItemsByGroupedId.get(groupedId) ?? [], item]);
  return item;
}

/** Uploads a photo or video of an album; the last upload to finish sends the album */
async function uploadAlbumItem(item: AlbumItem, localMessage: ApiMessage, onProgress?: ApiOnProgress) {
  item.localMessage = localMessage;
  try {
    item.pointer = await uploadMessageAttachment(item.params.attachment!, onProgress);
  } catch (err) {
    if (!onProgress?.isCanceled) markLocalMessageFailed(localMessage, err);
  }
  await settleAlbumItem(item);
}

/** Marks an item uploaded or failed; the last item of an album to settle sends it */
async function settleAlbumItem(item: AlbumItem) {
  item.isSettled = true;
  const groupedId = item.params.groupedId!;
  const items = albumItemsByGroupedId.get(groupedId)!;
  if (items.some(({ isSettled }) => !isSettled)) return;
  albumItemsByGroupedId.delete(groupedId);
  await sendAlbum(items.filter(({ pointer }) => pointer));
}

/**
 * Sends the uploaded items of an album as one message with the caption and reply of its items. The stored message
 * replaces the first local message, and the other local messages go away.
 */
async function sendAlbum(items: AlbumItem[]) {
  if (!items.length) return;
  const [first] = items;
  const localMessages = items.map(({ localMessage }) => localMessage!);
  const conversation = await getConversationByPeerId(first.localMessage!.chatId);
  if (!conversation) {
    localMessages.forEach((localMessage) => markLocalMessageFailed(localMessage));
    return;
  }
  clearOutgoingTyping(conversation.id);

  let isStored = false;
  try {
    const caption = items.find(({ params }) => params.text)?.params;
    const { body, bodyRanges } = caption
      ? await buildOutgoingBody({ text: caption.text!, entities: caption.entities })
      : { body: '', bodyRanges: [] };
    const { body: inlineBody, bodyAttachment } = await prepareLongBody(body);
    const { replyInfo } = first.params;
    const attachments = items.map(({ pointer }) => pointer!);
    if (bodyAttachment) attachments.push(bodyAttachment);

    await processor.sendDataMessage(conversation.id, {
      body: inlineBody,
      bodyRanges,
      attachments,
      quote: replyInfo?.type === 'message' ? await buildQuote(replyInfo.replyToMsgId) : undefined,
    }, (stored) => {
      isStored = true;
      trackLocalMessage(stored.id, localMessages[0]);
      if (localMessages.length > 1) {
        sendApiUpdate({
          '@type': 'deleteMessages', chatId: localMessages[0].chatId, ids: localMessages.slice(1).map(({ id }) => id),
        });
      }
    });
  } catch (err) {
    if (isStored) {
      logSendFailure('An album was stored but sending it failed', err);
    } else {
      localMessages.forEach((localMessage) => markLocalMessageFailed(localMessage, err));
    }
  }
}

/**
 * Stores and sends a message in place of a local one; the message updater swaps them once the message is stored, and
 * recipient statuses follow as message updates. Resolves to the stored id, or to `undefined` when it was not sent.
 */
async function sendWithLocalMessage(
  conversation: ConversationRecord, init: DataMessageInit, localMessage: ApiMessage,
): Promise<number | undefined> {
  let isStored = false;
  try {
    const sent = await processor.sendDataMessage(conversation.id, init, (stored) => {
      isStored = true;
      trackLocalMessage(stored.id, localMessage);
    });
    await reportBlockedRecipients(conversation, sent.id);
    return sent.id;
  } catch (err) {
    if (!isStored) markLocalMessageFailed(localMessage, err);
    else logSendFailure('A message was stored but sending it failed', err);
  }
  return undefined;
}

/**
 * Replies to the story open in the story viewer, or reacts to it with the emoji of a reaction message. Private replies
 * arrive in the chat as stored messages; group story replies stay with the story.
 */
async function sendStoryReply({
  replyInfo, text, entities, isReaction, attachment, attachments, sticker, gif, audio, poll, dice, contact, story,
  richMessage,
}: SendMessageParams) {
  if (replyInfo?.type !== 'story') return;
  // Signal story replies are text or an emoji reaction
  const hasOtherContent = Boolean(
    attachment || attachments?.length || sticker || gif || audio || poll || dice || contact || story || richMessage,
  );
  if (!text || hasOtherContent) {
    sendError(SEND_ERROR);
    return;
  }

  try {
    const reply = isReaction ? { emoji: text } : await buildOutgoingBody({ text, entities });
    await processor.sendStoryReply(replyInfo.storyId, reply);
  } catch (err) {
    logError(err);
    sendError(SEND_ERROR);
  }
}

/**
 * Asks the user about recipients whose new safety number kept the message from being sent, who can then send it
 * anyway (`sendMessageAnyway`) or check the safety number first
 */
async function reportBlockedRecipients(conversation: ConversationRecord, messageId: number) {
  const acis = await processor.getUnverifiedRecipients(messageId);
  if (!acis.length) return;

  sendApiUpdate({
    '@type': 'updateSafetyNumberBlock',
    chatId: getPeerId(conversation),
    messageId,
    userIds: await Promise.all(acis.map(getUserPeerId)),
  });
}

/** Accepts the new safety numbers of the recipients who did not get the message, and sends it to them again */
export async function sendMessageAnyway({ messageId }: { messageId: number }) {
  try {
    await processor.sendMessageAnyway(messageId);
    return true;
  } catch (err) {
    logSendFailure('Sending a message anyway failed', err);
    return undefined;
  }
}

/** Sends a message again to the recipients that did not get it; the safety number block can come back for some */
export async function resendMessage({ messageId }: { chat: ApiChat; messageId: number }) {
  try {
    const record = await db.getMessage(messageId);
    const conversation = record && await db.getConversation(record.conversationId);
    await processor.resendMessage(messageId);
    if (conversation) await reportBlockedRecipients(conversation, messageId);
    return true;
  } catch (err) {
    logSendFailure('Sending a message again failed', err);
    return undefined;
  }
}

/** The recipients of an outgoing message with how sending to each went, for the message details */
export async function fetchMessageSendDetails({ chat, messageId }: { chat: ApiChat; messageId: number }) {
  const conversation = await getConversationByPeerId(chat.id);
  const record = await db.getMessage(messageId);
  if (!conversation || record?.conversationId !== conversation.id || !record.isOutgoing) return undefined;

  const users = createUserResolver();
  const recipients: ApiMessageRecipient[] = [];
  for (const [aci, status] of Object.entries(record.recipientStatus ?? {})) {
    // A recipient that a later receipt moved on from `failed` keeps no reason
    const error = status === 'failed' ? record.recipientErrors?.[aci] : undefined;
    recipients.push({ userId: await users.getUserId(aci), status, error });
  }
  const apiUsers = await users.buildUsers();
  if (apiUsers.length) sendApiUpdate({ '@type': 'updateEntities', users: buildCollectionByKey(apiUsers, 'id') });
  return { recipients };
}

async function buildDataMessage(params: SendMessageParams, onProgress?: ApiOnProgress): Promise<DataMessageInit> {
  const {
    text, entities, replyInfo, attachment, sticker, contact, poll,
  } = params;
  const hasSupportedContent = Boolean(text || attachment || sticker || contact || poll);
  const hasUnsupportedContent = Boolean(params.richMessage || params.gif || params.audio
    || params.story || params.dice);
  if (!hasSupportedContent || hasUnsupportedContent) throw new Error('Signal has no counterpart for this content');
  if (sticker) return { sticker: await buildOutgoingSticker(sticker, onProgress) };
  if (contact) return { contact: [await buildOutgoingContact(contact)] };

  // A Signal poll has no description
  const { body, bodyRanges } = text && !poll
    ? await buildOutgoingBody({ text, entities })
    : { body: '', bodyRanges: [] };
  const { body: inlineBody, bodyAttachment } = await prepareLongBody(body);
  const attachments = attachment ? [await uploadMessageAttachment(attachment, onProgress)] : [];
  if (bodyAttachment) attachments.push(bodyAttachment);

  return {
    body: inlineBody,
    bodyRanges,
    attachments,
    quote: replyInfo?.type === 'message' ? await buildQuote(replyInfo.replyToMsgId) : undefined,
    isViewOnce: attachment?.ttlSeconds ? true : undefined,
    pollCreate: poll ? {
      question: poll.summary.question.text,
      allowMultiple: poll.summary.isMultipleChoice,
      options: poll.summary.answers.map((answer) => answer.text.text),
    } : undefined,
  };
}

/**
 * A sticker of a pack goes with its pack id and key and the image uploaded as an attachment, as Signal Desktop
 * `sendStickerMessage` sends it; a received sticker is sent again with its pack and attachment pointer
 */
async function buildOutgoingSticker(
  sticker: ApiSticker, onProgress?: ApiOnProgress,
): Promise<NonNullable<DataMessageInit['sticker']>> {
  const packSticker = parsePackStickerId(sticker.id);
  if (!packSticker) {
    const parsed = parseAttachmentMediaId(sticker.id);
    const record = parsed && await db.getMessage(parsed.messageId);
    const original = record?.dataMessage && fromBinary(DataMessageSchema, record.dataMessage).sticker;
    if (!original) throw new Error('The sticker has no pack');
    return original;
  }

  const { packId, packKey, stickerId } = packSticker;
  const blob = await fetchStickerImage(packId, packKey, stickerId);
  const blobUrl = URL.createObjectURL(blob);
  try {
    const data = await uploadMessageAttachment({
      blob,
      blobUrl,
      filename: '',
      mimeType: blob.type,
      size: blob.size,
      uniqueId: crypto.randomUUID(),
      quick: { width: STICKER_SIZE, height: STICKER_SIZE },
    }, onProgress);
    await addRecentSticker(packId, stickerId);
    return {
      packId: bufferFromHex(packId),
      packKey: bufferFromHex(packKey),
      stickerId,
      emoji: sticker.emoji,
      data,
    };
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

/**
 * A shared contact with its name, number and, for a Signal user, ACI (Signal Desktop `EmbeddedContact`); a user
 * without a known number goes by name and ACI
 */
async function buildOutgoingContact({
  firstName, lastName, phoneNumber, userId,
}: ApiContact): Promise<NonNullable<DataMessageInit['contact']>[number]> {
  const conversation = await getConversationByPeerId(userId);
  const aci = conversation?.type === 'private' ? conversation.id : undefined;
  const number = phoneNumber || conversation?.e164;
  return {
    name: { givenName: firstName || undefined, familyName: lastName || undefined },
    number: number
      ? [{ value: number.startsWith('+') ? number : `+${number}`, type: DataMessage_Contact_Phone_Type.MOBILE }]
      : [],
    aciBinary: aci ? uuidToBytes(aci) : undefined,
  };
}

/** Mention entities of users become Signal mentions by ACI */
export async function buildOutgoingBody(text: ApiFormattedText) {
  const aciByUserId = new Map<string, string>();
  for (const entity of text.entities ?? []) {
    if (entity.type !== ApiMessageEntityTypes.MentionName) continue;
    const conversation = await getConversationByPeerId(entity.userId);
    if (conversation?.type === 'private') aciByUserId.set(entity.userId, conversation.id);
  }
  return buildBodyRanges(text, (entity) => (
    entity.type === ApiMessageEntityTypes.MentionName ? aciByUserId.get(entity.userId) : undefined
  ));
}

/**
 * A body over `MAX_MESSAGE_BODY_BYTES` in UTF-8 travels whole as a `LONG_TEXT_CONTENT_TYPE` attachment, and the
 * inline body keeps the whole graphemes that fit (Signal Desktop `ts/util/longAttachment.std.ts`)
 */
async function prepareLongBody(body: string, onProgress?: ApiOnProgress) {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(body);
  if (bytes.length <= MAX_MESSAGE_BODY_BYTES) return { body, bodyAttachment: undefined };

  const blob = new Blob([bytes], { type: LONG_TEXT_CONTENT_TYPE });
  const blobUrl = URL.createObjectURL(blob);
  try {
    const bodyAttachment = await uploadMessageAttachment({
      blob, blobUrl, filename: '', mimeType: LONG_TEXT_CONTENT_TYPE, size: blob.size, uniqueId: crypto.randomUUID(),
    }, onProgress);

    let inlineBody = '';
    let size = 0;
    for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(body)) {
      size += encoder.encode(segment).length;
      if (size > MAX_MESSAGE_BODY_BYTES) break;
      inlineBody += segment;
    }
    return { body: inlineBody, bodyAttachment };
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

/** Signal quotes a whole message by author and timestamp, with its text and first attachment type */
async function buildQuote(messageId: number): Promise<MessageInitShape<typeof DataMessage_QuoteSchema> | undefined> {
  const target = await db.getMessage(messageId);
  if (!target?.dataMessage) return undefined;

  const quoted = fromBinary(DataMessageSchema, target.dataMessage);
  const attachment = quoted.attachments.find(({ contentType }) => contentType !== LONG_TEXT_CONTENT_TYPE);
  return {
    id: BigInt(target.sentAt),
    authorAci: target.authorAci,
    text: quoted.pollCreate?.question ?? quoted.body,
    bodyRanges: quoted.pollCreate ? [] : quoted.bodyRanges,
    attachments: attachment ? [{ contentType: attachment.contentType, fileName: attachment.fileName }] : [],
    type: quoted.pollCreate ? DataMessage_Quote_Type.POLL : DataMessage_Quote_Type.NORMAL,
  };
}

/** Builds messages of one conversation and sends the users, polls and link previews they refer to */
async function buildMessages(records: MessageRecord[], conversation: ConversationRecord) {
  const users = createUserResolver();
  const messages: ApiMessage[] = [];
  const polls: ApiMessagePoll[] = [];
  const webPages: ApiWebPage[] = [];
  for (const record of records) {
    const { message, poll, webPage } = await buildApiMessageWithPoll(record, conversation, users);
    messages.push(message);
    if (poll) polls.push(poll);
    if (webPage) webPages.push(webPage);
  }

  const apiUsers = await users.buildUsers();
  if (apiUsers.length || polls.length || webPages.length) {
    sendApiUpdate({
      '@type': 'updateEntities',
      users: buildCollectionByKey(apiUsers, 'id'),
      polls: polls.length ? polls : undefined,
      webPages: webPages.length ? webPages : undefined,
    });
  }
  return { messages, users: apiUsers };
}

/** Messages that the app shows, from `fromId` toward older or newer ones */
export async function collectShownMessages(conversationId: string, fromId: number, count: number, isNewer: boolean) {
  const result: MessageRecord[] = [];
  let cursorId = fromId;
  while (result.length < count) {
    const batch = isNewer
      ? await db.getMessagesFrom(conversationId, count, cursorId)
      : await db.getMessages(conversationId, count, cursorId);
    result.push(...batch.filter((message) => !getIsMessageHidden(message)));
    if (batch.length < count) break;
    // `getMessagesFrom` includes its bound and `getMessages` excludes it
    cursorId = isNewer ? batch[batch.length - 1].id + 1 : batch[batch.length - 1].id;
  }
  return result.slice(0, count);
}

async function showLocalMessage(
  chat: ApiChat,
  lastMessageId: number | undefined,
  content: MediaContent,
  options: {
    replyInfo?: ApiReplyInfo; poll?: ApiMessagePoll; groupedId?: string; wasDrafted?: boolean; localId?: number;
  },
) {
  const cleanContent = omitUndefined(content);
  if (cleanContent.text) cleanContent.text.emojiOnlyCount = getEmojiOnlyCountForMessage(cleanContent);
  const localMessage: ApiMessage = {
    id: options.localId ?? (lastMessageId ?? 0) + ++localMessageCounter / LOCAL_MESSAGES_LIMIT,
    chatId: chat.id,
    content: cleanContent,
    date: getServerTime(),
    isOutgoing: true,
    senderId: await getUserPeerId(getCurrentAccount()!.aci),
    replyInfo: options.replyInfo,
    groupedId: options.groupedId,
    isInAlbum: options.groupedId ? true : undefined,
    isForwardingAllowed: true,
  };
  sendApiUpdate({
    '@type': 'newMessage',
    id: localMessage.id,
    chatId: chat.id,
    message: localMessage,
    poll: options.poll,
    wasDrafted: options.wasDrafted,
  });
  return localMessage;
}

/** Logs why a send failed, without the account ids and phone numbers the message of an error can carry */
function logSendFailure(what: string, err: unknown) {
  logError(new Error(`${what}: ${describeSendError(err)}`));
}

/** Shows a local message as failed; an upload that fails for no known reason is named as such */
function markLocalMessageFailed(localMessage: ApiMessage, err?: unknown) {
  let localError: ApiLocalSendError | undefined;
  if (err) {
    logSendFailure('A message was not sent', err);
    const kind = getSendErrorKind(err);
    localError = kind === 'other' && err instanceof AttachmentUploadError ? 'upload' : kind;
  }
  sendApiUpdate({
    '@type': 'updateMessageSendFailed',
    chatId: localMessage.chatId,
    localId: localMessage.id,
    error: SEND_ERROR,
    sendError: localError,
  });
}

function sendError(message: string) {
  sendApiUpdate({ '@type': 'error', error: { message, hasErrorKey: true } });
}

async function sendTyping(conversationId: string, isTyping: boolean) {
  await processor.sendTyping(conversationId, isTyping).catch(() => {
    // Typing indicators are best effort
  });
}

async function stopOutgoingTyping(conversationId: string) {
  clearOutgoingTyping(conversationId);
  await sendTyping(conversationId, false);
}

/** A sent message ends typing on the recipients' side, so no stop is sent */
function clearOutgoingTyping(conversationId: string) {
  const typing = outgoingTypingByConversationId.get(conversationId);
  if (!typing) return;
  clearInterval(typing.refreshTimer);
  clearTimeout(typing.pauseTimer);
  outgoingTypingByConversationId.delete(conversationId);
}
