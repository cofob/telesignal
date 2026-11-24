import type { CallDirection, CallMode, CallStatus, CallType } from '../calls/callDisposition';
import type { ChatStyleRecord } from '../chatStyle/chatStyle';
import type { GroupState } from '../groups/fetchGroup';
import type { GroupUpdate } from '../groups/groupUpdates';
import type { ConversionDirection } from '../store/SecureIdbStore';
import type { StoreName } from './recordCrypto';

import { getEngineStoreName } from '../engineStoreName';
import { StorageLockedError } from '../store/atRest';
import {
  decodeOptionalRecord, decodeRecord, decodeRecords, encodeRecord, getIsRecordUnreadable, isEncryptedRecord,
  isSameEncryption,
} from './recordCrypto';

export type StoreRecordCounts = Record<StoreName, { encrypted: number; plain: number }>;

const STORE_NAMES = ['conversations', 'messages', 'stories', 'calls'] as const;

export type ConversationType = 'private' | 'group';

export type ConversationRecord = {
  // The ACI of a private conversation, or the base64 group identifier of a group
  id: string;
  // A positive number for the app's peer ids, assigned in creation order
  localId: number;
  type: ConversationType;
  // Private conversations
  e164?: string;
  profileName?: string;
  profileFamilyName?: string;
  systemName?: string;
  nickname?: string;
  about?: string;
  aboutEmoji?: string;
  avatarPath?: string;
  // When the profile was last fetched, by the device clock
  profileFetchedAt?: number;
  username?: string;
  // Groups
  masterKey?: Uint8Array;
  revision?: number;
  title?: string;
  description?: string;
  memberAcis?: string[];
  adminAcis?: string[];
  isAnnouncementsOnly?: boolean;
  // The decrypted state at `revision`; the fields above are read from it
  groupState?: GroupState;
  // Both
  expireTimer?: number;
  expireTimerVersion?: number;
  lastMessageId?: number;
  lastMessageAt?: number;
  unreadCount: number;
  isArchived?: boolean;
  isMarkedUnread?: boolean;
  isBlocked?: boolean;
  // Whether we accepted the message request, wrote first, or share our profile (`whitelisted` in storage)
  isAccepted?: boolean;
  // We reported the conversation as spam
  isReported?: boolean;
  // Stories of the contact or group show in the hidden list (`hideStory` in storage)
  isStoryHidden?: boolean;
  // The last `reportSpamToken` of an envelope from the contact, sent with spam reports
  reportingToken?: Uint8Array;
  mutedUntil?: number;
  // The chat color and wallpaper from the transferred history; the account's default style applies without one
  chatStyle?: ChatStyleRecord;
  // Position in the pinned conversations list
  pinIndex?: number;
  pinnedMessages?: { messageId: number; pinnedAt: number; expiresAt?: number }[];
};

// Safety number notices name the contact in `actorAci`; call notices stand for the call `callId`
export type MessageKind = 'message' | 'timerUpdate' | 'groupUpdate' | 'safetyNumberChange' | 'verifiedChange' | 'call'
  | 'pinnedMessage';

export type SendStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'viewed' | 'failed';

// Why a send to a recipient failed. `identityChanged` is the new safety number of a verified contact, which the
// user has to accept; `unregistered` is an account that no longer exists.
export type SendErrorKind = 'unregistered' | 'identityChanged' | 'network' | 'rateLimited' | 'other';

/**
 * The state of the automatic resends of an outgoing message: recipients who are still pending after a restart, or
 * failed for lack of a connection, get the message again until a day passed since `startedAt`
 */
export type SendRetry = {
  startedAt: number;
  // The sends so far, which set the pause before the next one
  attempt: number;
  // The earliest time of the next send while connected
  at: number;
};

export type MessageRecord = {
  id: number;
  conversationId: string;
  kind: MessageKind;
  // Empty for notices, so that they never match a lookup by author and timestamp; see `actorAci`
  authorAci: string;
  // Who caused a notice, such as a timer change
  actorAci?: string;
  // The message a `pinnedMessage` notice is about
  pinnedMessageId?: number;
  // What a `groupUpdate` notice says
  groupUpdate?: GroupUpdate;
  authorDeviceId?: number;
  // The Signal timestamp: with `authorAci` it identifies the message across devices
  sentAt: number;
  receivedAt: number;
  serverTimestamp?: number;
  isOutgoing: boolean;
  // Serialized `DataMessage`; absent after a remote delete
  dataMessage?: Uint8Array;
  // Earlier versions of an edited message, oldest first
  revisions?: { dataMessage: Uint8Array; editedAt: number }[];
  editedAt?: number;
  deletedAt?: number;
  // The group admin who deleted another member's message for everyone
  deletedByAdminAci?: string;
  // Text of the latest version, for previews and search
  body?: string;
  reactions?: { emoji: string; authorAci: string; sentAt: number }[];
  pollVotes?: { authorAci: string; optionIndexes: number[]; voteCount: number }[];
  isPollEnded?: boolean;
  expireTimer?: number;
  expiresAt?: number;
  readAt?: number;
  viewedAt?: number;
  isViewOnceOpened?: boolean;
  // Indexes in `DataMessage.attachments` that the CDN no longer has
  unavailableAttachmentIndexes?: number[];
  isStickerUnavailable?: true;
  // The primary device sent new pointers for attachments that the CDN no longer had; a second failure is final
  isBackfilled?: true;
  // The primary device could not get the attachments that the CDN no longer has, or did not answer; this device does
  // not ask for them again
  isBackfillFailed?: true;
  // Delivery state per recipient of an outgoing message
  recipientStatus?: Record<string, SendStatus>;
  // The reason for each recipient whose status is `failed`; messages stored earlier have none
  recipientErrors?: Record<string, SendErrorKind>;
  // Set while some recipient still has to get the message again, see `getMessagesToRetry`
  sendRetry?: SendRetry;
  isSealedSender?: boolean;
  // The server's id of the envelope, which spam reports name
  serverGuid?: string;
  // Verification notices: whether the safety number became verified, and whether another of our devices did it
  isVerified?: boolean;
  isFromOtherDevice?: boolean;
  // Call notices: the call in `CallRecord`, which holds its status
  callId?: string;
};

/**
 * A call of the call history, from sync messages of other devices and group call updates (Signal Desktop
 * `CallHistoryDetails` in `ts/types/CallDisposition.std.ts`). `status` `deleted` marks a call that was cleared: it stays
 * so that a late event cannot bring the call back.
 */
export type CallRecord = {
  callId: string;
  // The ACI of a 1:1 call, or the group id
  peerId: string;
  mode: CallMode;
  type: CallType;
  direction: CallDirection;
  status: CallStatus;
  // The Signal timestamp of the call; a deleted call has the time of its deletion
  timestamp: number;
  // The member who started a group call, when known
  ringerId?: string;
  // The call notice in the chat
  messageId?: number;
  // A missed or pending incoming call that the call log has not marked as read
  isUnseen?: true;
};

export type NewMessageRecord = Omit<MessageRecord, 'id'>;

/** A reply or reaction to a story; group story replies are kept only here, as in Signal Desktop */
export type StoryReply = {
  authorAci: string;
  sentAt: number;
  body?: string;
  emoji?: string;
};

/** Who an outgoing story went to, whether they may reply, and when they viewed it */
export type StoryRecipient = {
  status: SendStatus;
  isAllowedToReply: boolean;
  // Distribution lists that include the recipient; empty for group stories
  distributionListIds: string[];
  viewedAt?: number;
};

export type StoryRecord = {
  id: number;
  // The author's private conversation, the group of a group story, or our ACI for our distribution list stories
  conversationId: string;
  authorAci: string;
  authorDeviceId?: number;
  // The Signal timestamp: with `authorAci` it identifies the story
  sentAt: number;
  receivedAt: number;
  serverTimestamp?: number;
  expiresAt: number;
  isOutgoing: boolean;
  // Serialized `StoryMessage`
  storyMessage: Uint8Array;
  viewedAt?: number;
  // Outgoing stories
  recipients?: Record<string, StoryRecipient>;
  replies?: StoryReply[];
};

export type NewStoryRecord = Omit<StoryRecord, 'id'>;

const DB_NAME = 'ts-signal-messages';
// Records per transaction when the stores are rewritten, and per read when messages are filtered after decryption
const CONVERT_BATCH_SIZE = 100;
const FIND_BATCH_SIZE = 100;
const DB_VERSION = 5;
const CONVERSATIONS = 'conversations';
const MESSAGES = 'messages';
const STORIES = 'stories';
const CALLS = 'calls';
const BY_CONVERSATION = 'byConversation';
const BY_AUTHOR_SENT_AT = 'byAuthorSentAt';
const BY_EXPIRES_AT = 'byExpiresAt';
const BY_LOCAL_ID = 'byLocalId';
const BY_SEND_RETRY_AT = 'bySendRetryAt';
const BY_TIMESTAMP = 'byTimestamp';

/**
 * Conversations, messages and stories of the linked device in IndexedDB. Message ids grow in arrival order,
 * which is the order Signal Desktop shows messages in.
 */
export default class MessageDb {
  private db?: Promise<IDBDatabase>;

  private readonly name: string;

  /** Opens the database of an account slot, by default the slot of this page or worker */
  constructor(slot?: number) {
    this.name = getEngineStoreName(DB_NAME, slot);
  }

  getConversation(id: string) {
    return this.readRecord<ConversationRecord>(CONVERSATIONS, (store) => store.get(id));
  }

  getConversationByLocalId(localId: number) {
    return this.readRecord<ConversationRecord>(CONVERSATIONS, (store) => store.index(BY_LOCAL_ID).get(localId));
  }

  /** The next free `localId` */
  async allocateLocalId() {
    let maxLocalId = 0;
    const openCursor = (store: IDBObjectStore) => store.index(BY_LOCAL_ID).openKeyCursor(undefined, 'prev');
    await this.iterate(CONVERSATIONS, 'readonly', openCursor, (cursor) => {
      maxLocalId = cursor.key as number;
      return false;
    });
    return maxLocalId + 1;
  }

  getConversations() {
    return this.readRecords<ConversationRecord>(CONVERSATIONS, (store) => store.getAll());
  }

  async putConversation(record: ConversationRecord) {
    const stored = await encodeRecord(CONVERSATIONS, record);
    await this.request(CONVERSATIONS, 'readwrite', (store) => store.put(stored));
    return record;
  }

  /** Puts conversations in one transaction */
  async putConversations(records: ConversationRecord[]) {
    const stored = await Promise.all(records.map((record) => encodeRecord(CONVERSATIONS, record)));
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(CONVERSATIONS, 'readwrite');
      const store = transaction.objectStore(CONVERSATIONS);
      for (const record of stored) store.put(record);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  getMessage(id: number) {
    return this.readRecord<MessageRecord>(MESSAGES, (store) => store.get(id));
  }

  async addMessage(record: NewMessageRecord): Promise<MessageRecord> {
    const stored = await encodeRecord(MESSAGES, record);
    const id = await this.request<IDBValidKey>(MESSAGES, 'readwrite', (store) => store.add(stored));
    return { ...record, id: id as number };
  }

  /**
   * Adds messages in order in one transaction, skipping each message whose author and timestamp a stored message
   * has; notices have no author and are always added. Returns the added records, `undefined` for skipped ones.
   */
  async addMessagesIfAbsent(records: NewMessageRecord[]) {
    const stored = await Promise.all(records.map((record) => encodeRecord(MESSAGES, record)));
    const db = await this.open();
    return new Promise<(MessageRecord | undefined)[]>((resolve, reject) => {
      const transaction = db.transaction(MESSAGES, 'readwrite');
      const store = transaction.objectStore(MESSAGES);
      const results: (MessageRecord | undefined)[] = [];

      // Each step starts in the callback of the previous one, so a duplicate within `records` is found too
      function addNext() {
        const record = records[results.length];
        if (!record) return;
        const add = () => {
          const request = store.add(stored[results.length]);
          request.onsuccess = () => {
            results.push({ ...record, id: request.result as number });
            addNext();
          };
        };
        if (!record.authorAci) {
          add();
          return;
        }
        const lookup = store.index(BY_AUTHOR_SENT_AT).getKey([record.authorAci, record.sentAt]);
        lookup.onsuccess = () => {
          if (lookup.result === undefined) {
            add();
            return;
          }
          results.push(undefined);
          addNext();
        };
      }

      transaction.oncomplete = () => resolve(results);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
      addNext();
    });
  }

  async putMessage(record: MessageRecord) {
    const stored = await encodeRecord(MESSAGES, record);
    await this.request(MESSAGES, 'readwrite', (store) => store.put(stored));
    return record;
  }

  deleteMessage(id: number) {
    return this.request(MESSAGES, 'readwrite', (store) => store.delete(id));
  }

  /** Deletes the messages of a conversation up to `maxId` (every message by default) and returns their ids */
  async deleteConversationMessages(conversationId: string, maxId = Number.MAX_SAFE_INTEGER) {
    const range = IDBKeyRange.bound([conversationId, 0], [conversationId, maxId]);
    const ids: number[] = [];
    await this.iterate(MESSAGES, 'readwrite', (store) => store.index(BY_CONVERSATION).openCursor(range), (cursor) => {
      ids.push(cursor.primaryKey as number);
      cursor.delete();
      return true;
    });
    return ids;
  }

  /** Finds a message by its author and Signal timestamp */
  findMessage(authorAci: string, sentAt: number) {
    return this.readRecord<MessageRecord>(MESSAGES, (store) => store.index(BY_AUTHOR_SENT_AT).get([authorAci, sentAt]));
  }

  /** Messages of a conversation, newest first, older than `beforeId` when it is set */
  async getMessages(conversationId: string, limit: number, beforeId = Number.MAX_SAFE_INTEGER) {
    const range = IDBKeyRange.bound([conversationId, 0], [conversationId, beforeId], false, true);
    const stored: unknown[] = [];
    const openCursor = (store: IDBObjectStore) => store.index(BY_CONVERSATION).openCursor(range, 'prev');
    await this.iterate(MESSAGES, 'readonly', openCursor, (cursor) => {
      stored.push(cursor.value);
      return stored.length < limit;
    });
    return decodeRecords<MessageRecord>(MESSAGES, stored);
  }

  /**
   * The newest messages of a conversation that pass `filter`, newest first. A transaction cannot wait for the
   * decryption of a record, so the records come in batches that are decrypted between transactions.
   */
  async findLatestMessages(conversationId: string, limit: number, filter: (message: MessageRecord) => boolean) {
    const messages: MessageRecord[] = [];
    let upperBound: IDBValidKey = [conversationId, Number.MAX_SAFE_INTEGER];
    let isUpperBoundOpen = false;
    while (messages.length < limit) {
      const range = IDBKeyRange.bound([conversationId, 0], upperBound, false, isUpperBoundOpen);
      const batch: { key: IDBValidKey; stored: unknown }[] = [];
      const openCursor = (store: IDBObjectStore) => store.index(BY_CONVERSATION).openCursor(range, 'prev');
      await this.iterate(MESSAGES, 'readonly', openCursor, (cursor) => {
        batch.push({ key: cursor.key, stored: cursor.value });
        return batch.length < FIND_BATCH_SIZE;
      });
      for (const message of await decodeRecords<MessageRecord>(MESSAGES, batch.map(({ stored }) => stored))) {
        if (filter(message)) messages.push(message);
        if (messages.length >= limit) return messages;
      }
      if (batch.length < FIND_BATCH_SIZE) break;
      upperBound = batch[batch.length - 1].key;
      isUpperBoundOpen = true;
    }
    return messages;
  }

  /** Up to `limit` messages of every conversation in arrival order, starting after `afterId` */
  getMessagesAfter(afterId: number, limit: number) {
    return this.request<MessageRecord[]>(
      MESSAGES, 'readonly', (store) => store.getAll(IDBKeyRange.lowerBound(afterId, true), limit),
    );
  }

  /** Messages of a conversation, oldest first, starting at `fromId` */
  async getMessagesFrom(conversationId: string, limit: number, fromId: number) {
    const range = IDBKeyRange.bound([conversationId, fromId], [conversationId, Number.MAX_SAFE_INTEGER]);
    const stored: unknown[] = [];
    const openCursor = (store: IDBObjectStore) => store.index(BY_CONVERSATION).openCursor(range);
    await this.iterate(MESSAGES, 'readonly', openCursor, (cursor) => {
      stored.push(cursor.value);
      return stored.length < limit;
    });
    return decodeRecords<MessageRecord>(MESSAGES, stored);
  }

  /**
   * The id of each conversation's newest message older than `beforeId`, or `undefined` for one without such messages,
   * read from the index in one transaction without decrypting
   */
  async getNewestMessageIds(conversationIds: string[], beforeId: number) {
    const db = await this.open();
    const index = db.transaction(MESSAGES, 'readonly').objectStore(MESSAGES).index(BY_CONVERSATION);
    return Promise.all(conversationIds.map((conversationId) => new Promise<number | undefined>((resolve, reject) => {
      const range = IDBKeyRange.bound([conversationId, 0], [conversationId, beforeId], false, true);
      const request = index.openKeyCursor(range, 'prev');
      request.onsuccess = () => resolve(request.result?.primaryKey as number | undefined);
      request.onerror = () => reject(request.error);
    })));
  }

  countMessages(conversationId: string) {
    const range = IDBKeyRange.bound([conversationId, 0], [conversationId, Number.MAX_SAFE_INTEGER]);
    return this.request<number>(MESSAGES, 'readonly', (store) => store.index(BY_CONVERSATION).count(range));
  }

  /** Incoming messages of a conversation not read yet, up to `maxId` */
  async getUnreadMessages(conversationId: string, maxId = Number.MAX_SAFE_INTEGER) {
    const range = IDBKeyRange.bound([conversationId, 0], [conversationId, maxId]);
    const stored: unknown[] = [];
    await this.iterate(MESSAGES, 'readonly', (store) => store.index(BY_CONVERSATION).openCursor(range), (cursor) => {
      stored.push(cursor.value);
      return true;
    });
    const messages = await decodeRecords<MessageRecord>(MESSAGES, stored);
    return messages.filter((message) => !message.isOutgoing && !message.readAt && message.kind === 'message');
  }

  /** The Signal timestamp of the oldest stored message of `authorAci` */
  async getOldestSentAt(authorAci: string) {
    const range = IDBKeyRange.bound([authorAci, 0], [authorAci, Number.MAX_SAFE_INTEGER]);
    const [id] = await this.request<IDBValidKey[]>(
      MESSAGES, 'readonly', (store) => store.index(BY_AUTHOR_SENT_AT).getAllKeys(range, 1),
    );
    return id === undefined ? undefined : (await this.getMessage(id as number))?.sentAt;
  }

  /** Outgoing messages that wait for another send, the earliest retry first */
  getMessagesToRetry() {
    return this.readRecords<MessageRecord>(MESSAGES, (store) => store.index(BY_SEND_RETRY_AT).getAll());
  }

  /** Messages whose disappearing timer ran out by `time` */
  getExpiredMessages(time: number) {
    return this.readRecords<MessageRecord>(
      MESSAGES, (store) => store.index(BY_EXPIRES_AT).getAll(IDBKeyRange.upperBound(time)),
    );
  }

  /** The earliest time a disappearing message expires */
  async getNextExpiresAt() {
    // `expiresAt` is stored in the clear, so the record needs no decryption
    const message = await this.request<Pick<MessageRecord, 'expiresAt'> | undefined>(
      MESSAGES, 'readonly', (store) => store.index(BY_EXPIRES_AT).get(IDBKeyRange.lowerBound(0)),
    );
    return message?.expiresAt;
  }

  getStory(id: number) {
    return this.readRecord<StoryRecord>(STORIES, (store) => store.get(id));
  }

  async addStory(record: NewStoryRecord): Promise<StoryRecord> {
    const stored = await encodeRecord(STORIES, record);
    const id = await this.request<IDBValidKey>(STORIES, 'readwrite', (store) => store.add(stored));
    return { ...record, id: id as number };
  }

  async putStory(record: StoryRecord) {
    const stored = await encodeRecord(STORIES, record);
    await this.request(STORIES, 'readwrite', (store) => store.put(stored));
    return record;
  }

  deleteStory(id: number) {
    return this.request(STORIES, 'readwrite', (store) => store.delete(id));
  }

  /** Finds a story by its author and Signal timestamp */
  findStory(authorAci: string, sentAt: number) {
    return this.readRecord<StoryRecord>(STORIES, (store) => store.index(BY_AUTHOR_SENT_AT).get([authorAci, sentAt]));
  }

  /** Every stored story in arrival order; stories last a day, so there are few */
  getStories() {
    return this.readRecords<StoryRecord>(STORIES, (store) => store.getAll());
  }

  /** Stories whose day ran out by `time` */
  getExpiredStories(time: number) {
    return this.readRecords<StoryRecord>(
      STORIES, (store) => store.index(BY_EXPIRES_AT).getAll(IDBKeyRange.upperBound(time)),
    );
  }

  /** The earliest time a story expires */
  async getNextStoryExpiresAt() {
    const story = await this.request<Pick<StoryRecord, 'expiresAt'> | undefined>(
      STORIES, 'readonly', (store) => store.index(BY_EXPIRES_AT).get(IDBKeyRange.lowerBound(0)),
    );
    return story?.expiresAt;
  }

  getCall(peerId: string, callId: string) {
    return this.readRecord<CallRecord>(CALLS, (store) => store.get([peerId, callId]));
  }

  async putCall(record: CallRecord) {
    const stored = await encodeRecord(CALLS, record);
    await this.request(CALLS, 'readwrite', (store) => store.put(stored));
    return record;
  }

  /** Puts calls in one transaction */
  async putCalls(records: CallRecord[]) {
    const stored = await Promise.all(records.map((record) => encodeRecord(CALLS, record)));
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(CALLS, 'readwrite');
      const store = transaction.objectStore(CALLS);
      for (const record of stored) store.put(record);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  /** Every stored call, deleted ones included, in no particular order */
  getCalls() {
    return this.readRecords<CallRecord>(CALLS, (store) => store.getAll());
  }

  /** Calls that were not deleted, newest first */
  async getCallLog(limit: number) {
    const calls: CallRecord[] = [];
    let after: { key: IDBValidKey; primaryKey: IDBValidKey } | undefined;
    // A batch at a time, so a long log is read and decrypted only as far as `limit` needs
    while (calls.length < limit) {
      const batch: { key: IDBValidKey; primaryKey: IDBValidKey; stored: unknown }[] = [];
      const range = after ? IDBKeyRange.upperBound(after.key) : undefined;
      const openCursor = (store: IDBObjectStore) => store.index(BY_TIMESTAMP).openCursor(range, 'prev');
      await this.iterate(CALLS, 'readonly', openCursor, (cursor) => {
        // Records of the timestamp that the last batch ended at, which it already holds
        const isSeen = after && indexedDB.cmp(cursor.key, after.key) === 0
          && indexedDB.cmp(cursor.primaryKey, after.primaryKey) >= 0;
        if (!isSeen) batch.push({ key: cursor.key, primaryKey: cursor.primaryKey, stored: cursor.value });
        return batch.length < FIND_BATCH_SIZE;
      });
      for (const call of await decodeRecords<CallRecord>(CALLS, batch.map(({ stored }) => stored))) {
        if (call.status !== 'deleted' && calls.length < limit) calls.push(call);
      }
      if (batch.length < FIND_BATCH_SIZE) break;
      after = batch[batch.length - 1];
    }
    return calls;
  }

  async clear() {
    await this.request(CONVERSATIONS, 'readwrite', (store) => store.clear());
    await this.request(MESSAGES, 'readwrite', (store) => store.clear());
    await this.request(STORIES, 'readwrite', (store) => store.clear());
    await this.request(CALLS, 'readwrite', (store) => store.clear());
  }

  /**
   * Rewrites every record encrypted or decrypted, in batches that each commit in one transaction. A record that
   * changed since it was read stays as the change left it, because writes already use the current mode. Returns the
   * number of records that cannot be decrypted, which stay as they are.
   */
  async convertRecords(direction: ConversionDirection) {
    let failedCount = 0;
    for (const storeName of STORE_NAMES) {
      let lastKey: IDBValidKey | undefined;
      for (;;) {
        const batch = await this.readBatch(storeName, lastKey);
        if (!batch.length) break;
        lastKey = batch[batch.length - 1].key;

        const converted: { key: IDBValidKey; before: unknown; after: unknown }[] = [];
        for (const { key, stored } of batch) {
          if (isEncryptedRecord(stored) === (direction === 'encrypt')) continue;

          try {
            const record = await decodeRecord<object>(storeName, stored);
            const after = direction === 'encrypt' ? await encodeRecord(storeName, record, true) : record;
            converted.push({ key, before: stored, after });
          } catch (err) {
            if (err instanceof StorageLockedError) throw err;
            failedCount++;
          }
        }
        await this.swapRecords(storeName, direction, converted);
      }
    }
    return failedCount;
  }

  /** How many records of each store are encrypted and how many are not */
  async countRecords(): Promise<StoreRecordCounts> {
    const counts = {} as StoreRecordCounts;
    for (const storeName of STORE_NAMES) {
      counts[storeName] = { encrypted: 0, plain: 0 };
      let lastKey: IDBValidKey | undefined;
      for (;;) {
        const batch = await this.readBatch(storeName, lastKey);
        if (!batch.length) break;
        lastKey = batch[batch.length - 1].key;
        for (const { stored } of batch) counts[storeName][isEncryptedRecord(stored) ? 'encrypted' : 'plain']++;
      }
    }
    return counts;
  }

  /**
   * Whether a record in the clear is among the conversations and the newest records of the other stores: a cheap
   * check at start for a write that missed the key, which the full count does not need to repeat
   */
  async hasRecentPlainRecords(sampleSize: number) {
    for (const storeName of STORE_NAMES) {
      const sample: unknown[] = [];
      // Conversations are few, the others are checked from the newest
      const limit = storeName === CONVERSATIONS ? Number.MAX_SAFE_INTEGER : sampleSize;
      await this.iterate(storeName, 'readonly', (store) => store.openCursor(undefined, 'prev'), (cursor) => {
        sample.push(cursor.value);
        return sample.length < limit;
      });
      if (sample.some((stored) => !isEncryptedRecord(stored))) return true;
    }
    return false;
  }

  /** Deletes the encrypted records that the key does not open, and returns their number */
  async deleteUnreadableRecords() {
    let deletedCount = 0;
    for (const storeName of STORE_NAMES) {
      let lastKey: IDBValidKey | undefined;
      const unreadable: IDBValidKey[] = [];
      for (;;) {
        const batch = await this.readBatch(storeName, lastKey);
        if (!batch.length) break;
        lastKey = batch[batch.length - 1].key;
        for (const { key, stored } of batch) {
          if (await getIsRecordUnreadable(storeName, stored)) unreadable.push(key);
        }
      }
      if (!unreadable.length) continue;

      const db = await this.open();
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite');
        for (const key of unreadable) transaction.objectStore(storeName).delete(key);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
      deletedCount += unreadable.length;
    }
    return deletedCount;
  }

  private readBatch(storeName: StoreName, afterKey?: IDBValidKey) {
    const range = afterKey === undefined ? undefined : IDBKeyRange.lowerBound(afterKey, true);
    const batch: { key: IDBValidKey; stored: unknown }[] = [];
    return this.iterate(storeName, 'readonly', (store) => store.openCursor(range), (cursor) => {
      batch.push({ key: cursor.primaryKey, stored: cursor.value });
      return batch.length < CONVERT_BATCH_SIZE;
    }).then(() => batch);
  }

  private async swapRecords(
    storeName: StoreName,
    direction: ConversionDirection,
    converted: { key: IDBValidKey; before: unknown; after: unknown }[],
  ) {
    if (!converted.length) return;

    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      for (const { key, before, after } of converted) {
        store.get(key).onsuccess = (event) => {
          const current = (event.target as IDBRequest).result;
          // Only a record that is still as it was read: the engine may have written it again meanwhile
          const isUnchanged = direction === 'encrypt'
            ? current !== undefined && !isEncryptedRecord(current)
            : isSameEncryption(current, before);
          if (isUnchanged) store.put(after);
        };
      }
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  private async readRecord<T>(storeName: StoreName, build: (store: IDBObjectStore) => IDBRequest) {
    const stored = await this.request<unknown>(storeName, 'readonly', build);
    return stored === undefined ? undefined : decodeOptionalRecord<T>(storeName, stored);
  }

  private async readRecords<T>(storeName: StoreName, build: (store: IDBObjectStore) => IDBRequest) {
    return decodeRecords<T>(storeName, await this.request<unknown[]>(storeName, 'readonly', build));
  }

  private open() {
    if (this.db) return this.db;

    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      const openRequest = indexedDB.open(this.name, DB_VERSION);
      let isFailed = false;
      // A failed open is not kept, so that the next request opens the database again
      const fail = (err: unknown) => {
        isFailed = true;
        if (this.db === opening) this.db = undefined;
        reject(err);
      };
      openRequest.onupgradeneeded = ({ oldVersion }) => {
        const db = openRequest.result;
        if (oldVersion < 1) {
          db.createObjectStore(CONVERSATIONS, { keyPath: 'id' });
          const messages = db.createObjectStore(MESSAGES, { keyPath: 'id', autoIncrement: true });
          messages.createIndex(BY_CONVERSATION, ['conversationId', 'id']);
          messages.createIndex(BY_AUTHOR_SENT_AT, ['authorAci', 'sentAt']);
          messages.createIndex(BY_EXPIRES_AT, 'expiresAt');
        }
        if (oldVersion < 2) {
          const conversations = openRequest.transaction!.objectStore(CONVERSATIONS);
          conversations.createIndex(BY_LOCAL_ID, 'localId', { unique: true });
          // Conversations stored before local ids get them in creation order of the cursor
          let nextLocalId = 1;
          conversations.openCursor().onsuccess = ({ target }) => {
            const cursor = (target as IDBRequest<IDBCursorWithValue | undefined>).result;
            if (!cursor) return;
            cursor.update({ ...cursor.value, localId: nextLocalId++ });
            cursor.continue();
          };
        }
        if (oldVersion < 3) {
          const stories = db.createObjectStore(STORIES, { keyPath: 'id', autoIncrement: true });
          stories.createIndex(BY_AUTHOR_SENT_AT, ['authorAci', 'sentAt']);
          stories.createIndex(BY_EXPIRES_AT, 'expiresAt');
        }
        if (oldVersion < 4) {
          const messages = openRequest.transaction!.objectStore(MESSAGES);
          messages.createIndex(BY_SEND_RETRY_AT, 'sendRetry.at');
          // Messages that an earlier version left pending are sent again, or failed once a day passed
          messages.openCursor().onsuccess = ({ target }) => {
            const cursor = (target as IDBRequest<IDBCursorWithValue | undefined>).result;
            if (!cursor) return;
            const message = cursor.value as MessageRecord;
            if (message.isOutgoing && Object.values(message.recipientStatus ?? {}).includes('pending')) {
              const startedAt = message.editedAt ?? message.sentAt;
              cursor.update({ ...message, sendRetry: { startedAt, attempt: 0, at: startedAt } });
            }
            cursor.continue();
          };
        }
        if (oldVersion < 5) {
          const calls = db.createObjectStore(CALLS, { keyPath: ['peerId', 'callId'] });
          calls.createIndex(BY_TIMESTAMP, 'timestamp');
        }
      };
      // An older version of the app in another tab keeps the upgrade waiting until that tab closes
      openRequest.onblocked = () => fail(new Error('Close the other tabs of the app to update its database'));
      openRequest.onsuccess = () => {
        const db = openRequest.result;
        // A request that failed meanwhile opens its own connection
        if (isFailed) {
          db.close();
          return;
        }
        // A newer version of the app in another tab upgrades the database once this connection is closed
        db.onversionchange = () => {
          db.close();
          if (this.db === opening) this.db = undefined;
        };
        resolve(db);
      };
      openRequest.onerror = () => fail(openRequest.error);
    });
    this.db = opening;
    return opening;
  }

  private async request<T>(
    storeName: string, mode: IDBTransactionMode, build: (store: IDBObjectStore) => IDBRequest,
  ): Promise<T> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const request = build(db.transaction(storeName, mode).objectStore(storeName));
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => reject(request.error);
    });
  }

  /** Walks a cursor while `callback` returns `true` */
  private async iterate(
    storeName: string,
    mode: IDBTransactionMode,
    // Key cursors work too when `callback` reads only `key`
    build: (store: IDBObjectStore) => IDBRequest,
    callback: (cursor: IDBCursorWithValue) => boolean,
  ) {
    const db = await this.open();
    return new Promise<void>((resolve, reject) => {
      const request = build(db.transaction(storeName, mode).objectStore(storeName));
      request.onsuccess = () => {
        const cursor = request.result as IDBCursorWithValue | undefined;
        if (!cursor || !callback(cursor)) {
          resolve();
          return;
        }
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });
  }
}
