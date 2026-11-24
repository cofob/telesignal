import type { MessageInitShape } from '@bufbuild/protobuf';
import { clone, create, fromBinary, toBinary } from '@bufbuild/protobuf';

import type { CallHistoryHost } from '../calls/CallHistory';
import type MessageDb from '../db/MessageDb';
import type {
  CallRecord, ConversationRecord, MessageRecord, NewMessageRecord, NewStoryRecord, SendErrorKind, SendStatus,
  StoryRecipient, StoryRecord, StoryReply,
} from '../db/MessageDb';
import type { GroupState } from '../groups/fetchGroup';
import type { DecryptedGroupChange } from '../groups/groupChange';
import type {
  NotificationProfileDraft, NotificationProfilesState,
} from '../notificationProfiles/NotificationProfileManager';
import type { NotificationProfile } from '../notificationProfiles/notificationProfiles';
import type {
  AddressableMessage,
  AddressableMessageSchema,
  ConversationIdentifier,
  ConversationIdentifierSchema,
  DataMessage,
  EditMessage,
  GroupContextV2,
  ReceiptMessage,
  StoryMessage,
  SyncMessage,
  SyncMessage_AttachmentBackfillResponse, SyncMessage_DeleteForMe,
  SyncMessage_DeleteForMeSchema,
  SyncMessage_Sent,
  TypingMessage,
  Verified } from '../proto/generated/SignalService_pb';
import type { ContactRecord, ManifestRecord, StorageRecord } from '../proto/generated/StorageService_pb';
import type { DecryptedEnvelope } from '../receiver/decryptEnvelope';
import type { RecipientResult, SenderContext } from '../sender/sendContent';
import type { OutgoingMessage, StoryMessageRecipient } from '../sender/sendMessage';
import type { GroupTarget } from '../sender/sendToGroup';
import type SignalClient from '../SignalClient';
import type { AccountStorageField, LocalAccountFields, StorageChanges } from '../storage/storageRecords';
import type { StorageWrite } from '../storage/storageService';
import type { AccountRecord, EarlyReceiptRecord, StoryDistributionList } from '../store/SignalStore';

import { SIGNAL_PRIMARY_DEVICE_ID } from '../config';
import { bufferFromBase64, buffersEqual, bufferToBase64, bufferToHex } from '../../../util/encoding/buffer';
import { applyBackfillResponse, ATTACHMENT_BACKFILL_TIMEOUT_MS } from '../attachments/attachmentBackfill';
import { getAttachmentCacheKey, getIsAttachmentCached, removeAttachmentBlob } from '../attachments/attachmentCache';
import { downloadAttachment } from '../attachments/downloadAttachment';
import { getCallEvent, getCallLogEvent } from '../calls/callDisposition';
import { lookUpE164s, refreshE164s } from '../cdsi/cdsiLookup';
import { decryptGroupState, fetchGroup, GroupRequestError } from '../groups/fetchGroup';
import {
  applyGroupChange, decryptGroupChange, getChangeProfileKeys, verifyGroupChange,
} from '../groups/groupChange';
import { fetchGroupLog } from '../groups/groupLog';
import { saveGroupSendEndorsements } from '../groups/groupSendEndorsements';
import { buildGroupNotices } from '../groups/groupUpdates';
import { fetchProfile, fetchProfileIdentityKey, ProfileNotFoundError } from '../profiles/fetchProfile';
import { MAX_SPAM_REPORT_MESSAGES, reportSpam } from '../sender/reportSpam';
import { getAccessKey, saveProfileKey } from '../sender/sealedSender';
import {
  describeSendError, getSendErrorKind, GroupTerminatedError, NotGroupMemberError, UnregisteredUserError,
} from '../sender/sendErrors';
import {
  sendAttachmentBackfillRequestSync,
  sendBlockedSync,
  sendCallLogEventSync,
  sendConfigurationSync,
  sendDeleteForMeSync,
  sendMessage,
  sendMessageRequestResponseSync,
  sendReadSync,
  sendReceipts,
  sendStickerPackSync,
  sendStory,
  sendStoryDelete,
  sendStorySync,
  sendTyping,
  sendVerifiedSync,
  sendViewedSync,
  sendViewOnceOpenSync,
} from '../sender/sendMessage';
import { toPniServiceId, uuidToBytes, uuidToString } from '../serviceId';
import { getIsStickerPackValid } from '../stickers/stickerPackLinks';
import { getNextStickerPackPosition } from '../stickers/stickerPacks';
import {
  ACCOUNT_KEY,
  buildNewStorageWrite,
  buildStorageWrite,
  countPinnedConversations,
  getAci,
  getMutedUntil,
  getNotificationProfileKey,
  getOptionalBool,
  getStickerPackStorageKey,
  getStorageChanges,
  getStoryListKey,
  mergeStorageChanges,
  omitChangedFields,
  parseNotificationProfile,
  parseNotificationProfileOverride,
  parseStoryDistributionList,
} from '../storage/storageRecords';
import { syncStorageService } from '../storage/syncStorage';
import { saveIdentity } from '../store/protocolStores';
import {
  getAreStoryViewReceiptsEnabled, getStoryExpiresAt, getStoryListRecipientAcis, MY_STORY_ID,
} from '../stories/storyLists';
import { parseContactSync } from '../sync/contactSync';
import { wasm } from '../wasm';
import { getIsConversationAccepted } from './messageRequests';
import { addPinnedMessage, getCanPinMessages, getIsMessagePinnable } from './pinnedMessages';
import { getNextSendRetry, getRetryRecipients, SEND_RETRY_MAX_AGE_MS } from './sendRetry';
import { getFailedRecipients } from './sendState';

import {
  applyCallEvent, applyCallLogEvent, applyGroupCallUpdate, clearCallLog, markCallLogSeen,
} from '../calls/CallHistory';
import NotificationProfileManager from '../notificationProfiles/NotificationProfileManager';
import { GroupChange_ActionsSchema, GroupChangeSchema, Member_Role } from '../proto/generated/Groups_pb';
import {
  AttachmentPointerSchema,
  BodyRangeSchema,
  DataMessage_Flags,
  DataMessageSchema,
  GroupContextV2Schema,
  ReceiptMessage_Type,
  StoryMessageSchema,
  SyncMessage_CallLogEvent_Type,
  SyncMessage_FetchLatest_Type,
  SyncMessage_MessageRequestResponse_Type,
  SyncMessage_Request_Type,
  SyncMessage_StickerPackOperation_Type,
  TypingMessage_Action,
  Verified_State,
} from '../proto/generated/SignalService_pb';
import {
  AccountRecord_PhoneNumberSharingMode, ManifestRecordSchema, StorageRecordSchema,
} from '../proto/generated/StorageService_pb';

export type MessageChanges = {
  conversations: ConversationRecord[];
  messages: MessageRecord[];
  // Ids of `messages` stored for the first time
  addedMessageIds: number[];
  deletedMessages: { conversationId: string; id: number }[];
  stories: StoryRecord[];
  deletedStories: StoryRecord[];
  // Calls added, changed and deleted (with status `deleted`)
  calls: CallRecord[];
};

/** What a story from this device shows: a text story or an uploaded photo or video, with its caption ranges */
export type OutgoingStory = Pick<MessageInitShape<typeof StoryMessageSchema>, 'attachment' | 'bodyRanges'>;

/** A reply to a story: text, or a reaction */
export type StoryReplyContent = {
  body?: string;
  bodyRanges?: MessageInitShape<typeof BodyRangeSchema>[];
  emoji?: string;
};

export type MessageEdit = {
  body: string;
  bodyRanges: MessageInitShape<typeof BodyRangeSchema>[];
  // The full text of a long body, uploaded as a `LONG_TEXT_CONTENT_TYPE` attachment
  bodyAttachment?: MessageInitShape<typeof AttachmentPointerSchema>;
};

// The group after a refresh; `members` are the full members to take send endorsements for
type GroupRefreshResult = {
  conversation?: ConversationRecord;
  members?: string[];
  sendEndorsementsResponse?: Uint8Array;
};

export type ConversationPatch = Partial<ConversationRecord> & Pick<ConversationRecord, 'id' | 'type'>;

export type PinnedMessage = Omit<NonNullable<ConversationRecord['pinnedMessages']>[number], 'messageId'>;

/** Transferred message history to store, see `importHistory` */
export type HistoryBatch = {
  conversations: ConversationPatch[];
  messages: { record: NewMessageRecord; pin?: PinnedMessage }[];
  // The conversations are in use: the patches fill fields that are absent, and the last message never moves back
  isMerge?: boolean;
};

export type TypingEvent = {
  conversationId: string;
  senderAci: string;
  isTyping: boolean;
};

type MessageReaction = NonNullable<MessageRecord['reactions']>[number];

type MessageProcessorEvents = {
  onChanges(changes: MessageChanges): void;
  onTyping(event: TypingEvent): void;
  onError(error: Error): void;
  // Ids of sticker packs installed or removed here or on another device
  onStickerPacksChange?(ids: string[]): void;
  // The notification profiles, the one that is on, or the manual override changed
  onNotificationProfilesChange?(state: NotificationProfilesState): void;
  // Our username or phone number discoverability changed on another device, which key transparency has to learn
  onOwnIdentifierChange?(identifier: 'username' | 'phoneNumberDiscoverability'): void;
};

type StickerPackState = { isInstalled: true; position?: number } | { uninstalledAt: number };

type MessageSource = {
  authorAci: string;
  authorDeviceId?: number;
  sentAt: number;
  serverTimestamp?: number;
  isOutgoing: boolean;
  isSealedSender?: boolean;
  // Sent transcripts: the private conversation and the recipients the message reached
  destinationAci?: string;
  sentTo?: { serviceId: string; isSealedSender: boolean }[];
  expirationStartTimestamp?: number;
  serverGuid?: string;
};

type MessageRequestResponseType = SyncMessage_MessageRequestResponse_Type;

/** A storage service write with what `commitStorageWrite` needs to know about the changes it carries */
type PendingStorageWrite = {
  write: StorageWrite;
  // The keys of `storageChanges` that the write carries
  writtenKeys: string[];
  changeCount: number;
  // The write carries a new username, which our other devices learn through a `usernameChange` sync
  hasUsernameChange: boolean;
};

/** Account record fields that this device changes; each one present is written to the storage service */
export type OwnAccountUpdate = Partial<Pick<ConversationRecord, 'username'> & LocalAccountFields>;

export type MessageSettingsUpdate = Pick<OwnAccountUpdate,
  'isReadReceiptsEnabled' | 'isTypingIndicatorsEnabled' | 'isLinkPreviewsEnabled' | 'isSealedSenderIndicatorsEnabled'
  | 'universalExpireTimer'
>;

// The account record fields that our profile fills, see `updateOwnConversation`
const PROFILE_STORAGE_FIELDS: AccountStorageField[] = ['givenName', 'familyName', 'avatarUrlPath'];
const OWN_ACCOUNT_FIELDS: Record<keyof OwnAccountUpdate, AccountStorageField> = {
  username: 'username',
  usernameLink: 'usernameLink',
  isPhoneNumberShared: 'phoneNumberSharingMode',
  isPhoneNumberUnlisted: 'unlistedPhoneNumber',
  isStoriesDisabled: 'storiesDisabled',
  isStoryViewReceiptsEnabled: 'storyViewReceiptsEnabled',
  isReadReceiptsEnabled: 'readReceipts',
  isTypingIndicatorsEnabled: 'typingIndicators',
  isLinkPreviewsEnabled: 'linkPreviews',
  isSealedSenderIndicatorsEnabled: 'sealedSenderIndicators',
  universalExpireTimer: 'universalExpireTimer',
};

const DELIVERY_RECEIPT_DELAY_MS = 1000;
// Signal Desktop `ts/util/expirationTimer.std.ts` and `ts/models/conversations.preload.ts`
const INITIAL_EXPIRE_TIMER_VERSION = 1;
const MAX_EXPIRE_TIMER_VERSION = 0xffffffff;
// Signal Desktop `runStorageServiceSyncJob` and `runStorageServiceUploadJob` in `ts/services/storage.preload.ts`
const STORAGE_SYNC_DELAY_MS = 500;
// Merges of stored storage records for record types and fields that earlier versions stored without reading
const STORAGE_MERGE_PASSES: { id: string; cases: NonNullable<StorageRecord['record']['case']>[] }[] = [
  { id: 'installedStickerPack', cases: ['installedStickerPack'] },
  { id: 'storyDistributionList', cases: ['storyDistributionList'] },
  // Notification profiles, and the manual override and sync setting of the account record
  { id: 'notificationProfiles', cases: ['notificationProfile', 'account'] },
  // `hideStory` of contacts and groups, `storiesDisabled` and `storyViewReceiptsEnabled` of the account
  { id: 'storyFields', cases: ['contact', 'groupV2', 'account'] },
];
const DAY_MS = 24 * 60 * 60 * 1000;
// Signal Desktop `ts/routineProfileRefresh.preload.ts`
const PROFILE_MAX_AGE_MS = 3 * DAY_MS;
const MAX_PROFILES_TO_REFRESH = 50;
// Signal Desktop `ts/util/canEditMessage.dom.ts` and `ts/util/getDeleteMaxAgeMs.std.ts`
const EDIT_MAX_AGE_MS = DAY_MS;
const MAX_EDIT_COUNT = 10;
const DELETE_FOR_EVERYONE_MAX_AGE_MS = DAY_MS;
export const LONG_TEXT_CONTENT_TYPE = 'text/x-signal-plain';
const ACI_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TIMEOUT_MS = 2 ** 31 - 1;
const MIN_SEND_RETRY_TIMER_MS = 1000;
const EARLY_RECEIPT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_EARLY_RECEIPTS = 500;
// Signal Desktop `ts/util/isConversationUnregistered.std.ts`: group sends skip a member for this long after a send
// found their account gone
const UNREGISTERED_SKIP_MS = 6 * 60 * 60 * 1000;
const UUID_BYTE_LENGTH = 16;
const STATUS_RANK: Record<SendStatus, number> = {
  failed: 0, pending: 1, sent: 2, delivered: 3, read: 4, viewed: 5,
};
// Signal Desktop `ts/models/conversations.preload.ts` (`destroyMessages`): a conversation delete names this many of
// its latest messages, so other devices find where it ended
const CONVERSATION_DELETE_MESSAGE_COUNT = 5;
const BLOCK_RESPONSES = new Set<MessageRequestResponseType>([
  SyncMessage_MessageRequestResponse_Type.BLOCK,
  SyncMessage_MessageRequestResponse_Type.BLOCK_AND_DELETE,
  SyncMessage_MessageRequestResponse_Type.BLOCK_AND_SPAM,
]);
const DELETE_RESPONSES = new Set<MessageRequestResponseType>([
  SyncMessage_MessageRequestResponse_Type.DELETE,
  SyncMessage_MessageRequestResponse_Type.BLOCK_AND_DELETE,
]);
const SPAM_RESPONSES = new Set<MessageRequestResponseType>([
  SyncMessage_MessageRequestResponse_Type.SPAM,
  SyncMessage_MessageRequestResponse_Type.BLOCK_AND_SPAM,
]);
const STATUS_BY_RECEIPT_TYPE: Record<ReceiptMessage_Type, EarlyReceiptRecord['status']> = {
  [ReceiptMessage_Type.DELIVERY]: 'delivered',
  [ReceiptMessage_Type.READ]: 'read',
  [ReceiptMessage_Type.VIEWED]: 'viewed',
};

/**
 * Turns decrypted content into conversations and messages in `MessageDb` (Signal Desktop
 * `ts/textsecure/MessageReceiver.preload.ts` and the handlers in `ts/background.preload.ts`), and sends
 * what the protocol expects in return: delivery receipts, read receipts and read syncs.
 * All database changes run one at a time and are reported through `onChanges`.
 */
export default class MessageProcessor {
  private serial = Promise.resolve();

  private changes = createChanges();

  private deliveryReceipts = new Map<string, number[]>();

  private deliveryReceiptTimer?: ReturnType<typeof setTimeout>;

  // Changes on every `stop`, so work queued for the previous account does not run for the next one
  private generation = 0;

  private expirationTimer?: ReturnType<typeof setTimeout>;

  private groupRefreshes = new Map<string, Promise<ConversationRecord | undefined>>();

  // Profiles of new conversations are fetched one at a time to stay within the server's rate limit
  private profileQueue = Promise.resolve();

  private lastTimestamp = 0;

  // Receipts and syncs for local changes made without a connection, sent after the next one
  private pendingSends: ((context: SenderContext) => Promise<void>)[] = [];

  // Messages whose send is running, with the number of running sends (an edit can start during the first send);
  // a retry pass leaves them alone
  private sendsInFlight = new Map<number, number>();

  // Retry passes run one at a time
  private retryPass = Promise.resolve();

  private retryTimer?: ReturnType<typeof setTimeout>;

  // Storage service syncs run one at a time
  private storageSync = Promise.resolve();

  private storageSyncTimer?: ReturnType<typeof setTimeout>;

  private isStorageSyncQueued = false;

  // Counts local storage record changes, so a write clears only the changes it carried
  private storageChangeCount = 0;

  // What call history changes in messages and chats goes through the processor, which serializes it
  private callHistory: CallHistoryHost;

  private notificationProfiles: NotificationProfileManager;

  // Requests for attachments that the primary device has not completed, by message id; the timer ends a request that
  // gets no answer, and is gone once the phone answered
  private backfillRequests = new Map<number, ReturnType<typeof setTimeout> | undefined>();

  constructor(
    private db: MessageDb,
    private client: SignalClient,
    private events: MessageProcessorEvents,
  ) {
    this.callHistory = {
      db,
      addMessage: (conversation, record) => this.addMessage(conversation, record),
      putMessage: (record) => this.putMessage(record),
      removeMessage: (message) => this.removeMessage(message),
      updateLastMessage: (conversationId) => this.updateLastMessage(conversationId),
      addChangedCall: (call) => {
        this.changes.calls.push(call);
      },
    };
    this.notificationProfiles = new NotificationProfileManager({
      store: client.store,
      markStorageChanges: (added) => this.markStorageChanges(added),
      runSerial: (task) => this.runSerial(task),
      onChange: (state) => this.events.onNotificationProfilesChange?.(state),
    });
  }

  /** Handles one decrypted envelope; `SignalClient.connect` passes it as `onContent` */
  async processContent(decrypted: DecryptedEnvelope) {
    await this.loadMessageGroup(decrypted);
    await this.runSerial(() => this.handleContent(decrypted));
  }

  /**
   * Starts the disappearing messages timer for messages stored earlier and sends the messages again that earlier
   * sends left undelivered, which runs after each connection
   */
  start() {
    this.runSerial(() => this.deleteExpiredMessages()).catch(this.events.onError);
    this.runSerial(() => this.notificationProfiles.refresh(true)).catch(this.events.onError);
    void this.flushPendingSends();
    this.retryUnsentMessages(true);
  }

  /** Stops the timers and drops the queued sends, storage syncs and profile fetches of the current account */
  stop() {
    this.generation++;
    clearTimeout(this.expirationTimer);
    clearTimeout(this.deliveryReceiptTimer);
    clearTimeout(this.storageSyncTimer);
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.notificationProfiles.stop();
    this.backfillRequests.forEach(clearTimeout);
    this.backfillRequests.clear();
    this.sendsInFlight.clear();
    this.retryPass = Promise.resolve();
    this.deliveryReceiptTimer = undefined;
    this.storageSyncTimer = undefined;
    this.isStorageSyncQueued = false;
    this.deliveryReceipts.clear();
    this.pendingSends = [];
    this.profileQueue = Promise.resolve();
    this.storageSync = Promise.resolve();
  }

  /**
   * Stores and sends a message from this device. The message is stored as pending first, then each
   * recipient's status follows the send; without a connection every recipient fails. `onStored` runs
   * before the stored message is reported through `onChanges`.
   */
  async sendDataMessage(
    conversationId: string,
    init: MessageInitShape<typeof DataMessageSchema>,
    onStored?: (message: MessageRecord) => void,
  ) {
    const account = await this.getAccount();

    const {
      conversation, message, dataMessage, sentAt, startedTimer,
    } = await this.runSerial(async () => {
      // An ACI that has no conversation yet starts one
      const existing = await this.db.getConversation(conversationId)
        ?? (ACI_PATTERN.test(conversationId) ? await this.ensurePrivateConversation(conversationId) : undefined);
      if (!existing) throw new Error(`Unknown conversation ${conversationId}`);
      assertGroupIsOpen(existing);
      const universalTimer = await this.maybeStartUniversalTimer(existing, account);
      const found = universalTimer?.conversation ?? existing;
      const messageAt = this.allocateTimestamp();
      // Writing accepts the message request, so the message carries our profile key
      const accepted = found.isAccepted
        ? found
        : await this.putLocalConversation(found, { ...found, isAccepted: true });
      const outgoing = createOutgoingDataMessage(account, accepted, init, messageAt);
      const { message: added } = await this.addMessage(accepted, {
        conversationId,
        kind: 'message',
        authorAci: account.aci,
        authorDeviceId: account.deviceId,
        sentAt: messageAt,
        receivedAt: messageAt,
        isOutgoing: true,
        dataMessage: toBinary(DataMessageSchema, outgoing),
        body: outgoing.body || undefined,
        expireTimer: accepted.expireTimer || undefined,
        expiresAt: accepted.expireTimer ? messageAt + accepted.expireTimer * 1000 : undefined,
        readAt: messageAt,
        recipientStatus: buildPendingStatus(getRecipientAcis(accepted, account.aci)),
        sendRetry: { startedAt: messageAt, attempt: 0, at: messageAt },
      });
      this.markSendStarted(added.id);
      try {
        onStored?.(added);
      } catch (err) {
        this.markSendEnded(added.id);
        throw err;
      }
      return {
        conversation: accepted, message: added, dataMessage: outgoing, sentAt: messageAt, startedTimer: universalTimer,
      };
    });

    if (startedTimer) {
      // The timer is stored with its notice; a failed update must not keep the message from going out
      await this.sendExpireTimerUpdate(account, startedTimer.conversation, startedTimer.timestamp)
        .catch(this.events.onError);
    }
    return this.sendStoredMessage(conversation, message, { case: 'dataMessage', value: dataMessage }, {
      timestamp: sentAt,
      expirationStartTimestamp: conversation.expireTimer ? sentAt : undefined,
    });
  }

  /**
   * The first message of a private chat in which we never sent or received a message and that has no timer starts
   * the timer that the account sets for new chats (Signal Desktop `maybeApplyUniversalTimer` in
   * `ts/models/conversations.preload.ts`, called before a message is queued). Note to Self keeps messages for good,
   * as in Signal Android. Runs in the serial queue; the timer update goes out afterwards.
   */
  private async maybeStartUniversalTimer(conversation: ConversationRecord, account: AccountRecord) {
    const { universalExpireTimer, aci } = account;
    if (!universalExpireTimer || conversation.id === aci || conversation.type !== 'private'
      || conversation.expireTimer) {
      return undefined;
    }
    const [firstMessage] = await this.db.findLatestMessages(conversation.id, 1, ({ kind }) => kind === 'message');
    if (firstMessage) return undefined;

    const timestamp = this.allocateTimestamp();
    const updated = await this.storeExpireTimer(conversation.id, universalExpireTimer, account, timestamp);
    return updated && { conversation: updated, timestamp };
  }

  /**
   * Sets the disappearing messages timer of a private conversation, with a notice, and tells the contact and our
   * other devices in a message that only carries the timer (Signal Desktop `updateExpirationTimer` and
   * `ts/jobs/helpers/sendDirectExpirationTimerUpdate.preload.ts`). Each change counts the timer version up, so
   * that the latest change wins on every device. Groups keep the timer in their state instead.
   */
  async setExpireTimer(conversationId: string, seconds: number) {
    const account = await this.getAccount();
    const timestamp = this.allocateTimestamp();

    const updated = await this.runSerial(() => this.storeExpireTimer(conversationId, seconds, account, timestamp));
    if (updated) await this.sendExpireTimerUpdate(account, updated, timestamp);
  }

  /** Stores the timer and its notice; resolves with the conversation, or `undefined` when the timer is the same */
  private async storeExpireTimer(conversationId: string, seconds: number, account: AccountRecord, timestamp: number) {
    const timer = seconds || undefined;
    const found = await this.db.getConversation(conversationId);
    if (found?.type !== 'private') throw new Error(`Unknown private conversation ${conversationId}`);
    if (found.expireTimer === timer) return undefined;

    const previousVersion = found.expireTimerVersion ?? INITIAL_EXPIRE_TIMER_VERSION;
    const withTimer = await this.putConversation({
      ...found, expireTimer: timer, expireTimerVersion: Math.min(previousVersion + 1, MAX_EXPIRE_TIMER_VERSION),
    });
    const { conversation } = await this.addMessage(withTimer, {
      conversationId,
      kind: 'timerUpdate',
      authorAci: '',
      actorAci: account.aci,
      sentAt: timestamp,
      receivedAt: timestamp,
      isOutgoing: true,
      expireTimer: timer,
      readAt: timestamp,
    });
    return conversation;
  }

  private async sendExpireTimerUpdate(account: AccountRecord, conversation: ConversationRecord, timestamp: number) {
    const message = createOutgoingDataMessage(
      account, conversation, { flags: DataMessage_Flags.EXPIRATION_TIMER_UPDATE }, timestamp,
    );
    await this.sendWithRetry(conversation, [conversation.id], { case: 'dataMessage', value: message }, timestamp);
  }

  /**
   * Edits the text of an outgoing message (Signal Desktop `ts/util/sendEditedMessage.preload.ts`): the earlier
   * version goes to `revisions` and the edit is sent with the original timestamp as its target. Messages older
   * than a day and messages edited `MAX_EDIT_COUNT` times stay as they are, except in Note to Self.
   */
  async sendEditMessage(messageId: number, edit: MessageEdit) {
    const account = await this.getAccount();
    const editedAt = this.allocateTimestamp();

    const { conversation, message, editMessage } = await this.runSerial(async () => {
      const target = await this.db.getMessage(messageId);
      const found = target && await this.db.getConversation(target.conversationId);
      if (!target?.dataMessage || !found || target.authorAci !== account.aci || target.deletedAt) {
        throw new Error('The message cannot be edited');
      }
      assertGroupIsOpen(found);
      const isNoteToSelf = found.id === account.aci;
      const isTooOld = editedAt - target.sentAt > EDIT_MAX_AGE_MS;
      if (!isNoteToSelf && (isTooOld || (target.revisions?.length ?? 0) >= MAX_EDIT_COUNT)) {
        throw new Error('The message can no longer be edited');
      }

      const edited = fromBinary(DataMessageSchema, target.dataMessage);
      edited.body = edit.body;
      edited.bodyRanges = edit.bodyRanges.map((range) => create(BodyRangeSchema, range));
      edited.attachments = edited.attachments.filter(({ contentType }) => contentType !== LONG_TEXT_CONTENT_TYPE);
      if (edit.bodyAttachment) edited.attachments.push(create(AttachmentPointerSchema, edit.bodyAttachment));
      setOutgoingFields(edited, account, found, editedAt);
      const updated = await this.putMessage({
        ...target,
        revisions: [...target.revisions ?? [], {
          dataMessage: target.dataMessage, editedAt: target.editedAt ?? target.sentAt,
        }],
        dataMessage: toBinary(DataMessageSchema, edited),
        body: edited.body || undefined,
        editedAt,
        // Like Signal Desktop, the message shows the send state of its latest edit
        recipientStatus: buildPendingStatus(getRecipientAcis(found, account.aci)),
        recipientErrors: undefined,
        sendRetry: { startedAt: editedAt, attempt: 0, at: editedAt },
      });
      this.markSendStarted(updated.id);
      return {
        conversation: found,
        message: updated,
        editMessage: { targetSentTimestamp: BigInt(target.sentAt), dataMessage: edited },
      };
    });

    return this.sendStoredMessage(conversation, message, { case: 'editMessage', value: editMessage }, {
      timestamp: editedAt,
    });
  }

  /**
   * Sets our reaction to a message, or removes it when `emoji` is absent; Signal keeps one reaction per person.
   * The reaction is shown at once and taken back when no recipient gets it.
   */
  async sendReaction(messageId: number, emoji?: string) {
    const account = await this.getAccount();
    const sentAt = this.allocateTimestamp();

    const prepared = await this.runSerial(async () => {
      const target = await this.db.getMessage(messageId);
      const found = target && await this.db.getConversation(target.conversationId);
      if (!target || !found || target.kind !== 'message' || !target.dataMessage) {
        throw new Error('The message cannot have reactions');
      }
      assertGroupIsOpen(found);
      const previous = target.reactions?.find(({ authorAci }) => authorAci === account.aci);
      if (!emoji && !previous) return undefined;
      await this.putReaction(target, account.aci, emoji ? { emoji, authorAci: account.aci, sentAt } : undefined);
      return { conversation: found, target, previous };
    });
    if (!prepared) return;

    const { conversation, target, previous } = prepared;
    const isSent = await this.sendToConversation(conversation, {
      reaction: {
        emoji: emoji ?? previous!.emoji,
        remove: !emoji,
        targetAuthorAci: target.authorAci,
        targetSentTimestamp: BigInt(target.sentAt),
      },
    }, sentAt);
    if (!isSent) {
      await this.runSerial(async () => {
        const current = await this.db.getMessage(target.id);
        if (current) await this.putReaction(current, account.aci, previous);
      });
      throw new Error('The reaction was not sent');
    }
  }

  /**
   * Pins a message for everyone in the chat, for `durationSeconds` or until it is unpinned, or unpins it (Signal
   * Desktop `onPinnedMessageAdd` and `onPinnedMessageRemove` in `ts/state/ducks/conversations.preload.ts`,
   * `ts/jobs/helpers/sendPinMessage.preload.ts`). The change is shown at once and taken back when no recipient gets it.
   */
  async sendPin(messageId: number, isPinned: boolean, durationSeconds?: number) {
    const account = await this.getAccount();
    const sentAt = this.allocateTimestamp();

    const prepared = await this.runSerial(async () => {
      const target = await this.db.getMessage(messageId);
      const found = target && await this.db.getConversation(target.conversationId);
      if (!target || !found || !getIsMessagePinnable(target) || !getCanPinMessages(found, account.aci)) {
        throw new Error('The message cannot be pinned');
      }
      const isChanged = isPinned || Boolean(found.pinnedMessages?.some((pin) => pin.messageId === target.id));
      if (!isChanged) return undefined;
      await this.putConversation({
        ...found,
        pinnedMessages: isPinned
          ? addPinnedMessage(found.pinnedMessages, {
            messageId: target.id,
            pinnedAt: sentAt,
            expiresAt: durationSeconds ? sentAt + durationSeconds * 1000 : undefined,
          })
          : found.pinnedMessages?.filter((pin) => pin.messageId !== target.id),
      });
      return { conversation: found, target };
    });
    if (!prepared) return;

    const { conversation, target } = prepared;
    const targetFields = {
      targetAuthorAciBinary: uuidToBytes(target.authorAci),
      targetSentTimestamp: BigInt(target.sentAt),
    };
    const isSent = await this.sendToConversation(conversation, isPinned ? {
      pinMessage: {
        ...targetFields,
        pinDuration: durationSeconds
          ? { case: 'pinDurationSeconds', value: durationSeconds }
          : { case: 'pinDurationForever', value: true },
      },
    } : { unpinMessage: targetFields }, sentAt);
    if (!isSent) {
      await this.runSerial(async () => {
        const current = await this.db.getConversation(conversation.id);
        if (current) await this.putConversation({ ...current, pinnedMessages: conversation.pinnedMessages });
      });
      throw new Error('The pin was not sent');
    }
  }

  /**
   * Deletes messages for everyone (Signal Desktop `ts/util/canDeleteForEveryone.preload.ts`): our own messages
   * through `delete`, other members' group messages through `adminDelete` when we are an admin, each within
   * a day of sending. Nothing is deleted when any message does not qualify.
   */
  async deleteForEveryone(messageIds: number[]) {
    const account = await this.getAccount();
    const now = Date.now();

    const targets = await this.runSerial(async () => {
      const found: { message: MessageRecord; conversation: ConversationRecord; isAdminDelete: boolean }[] = [];
      for (const id of messageIds) {
        const message = await this.db.getMessage(id);
        const conversation = message && await this.db.getConversation(message.conversationId);
        if (!message || !conversation || message.kind !== 'message' || message.deletedAt) {
          throw new Error('The message cannot be deleted for everyone');
        }
        const isOwn = message.authorAci === account.aci;
        const isAdminDelete = !isOwn && conversation.type === 'group'
          && Boolean(conversation.adminAcis?.includes(account.aci));
        const age = now - (message.serverTimestamp ?? message.sentAt);
        if ((!isOwn && !isAdminDelete) || conversation.id === account.aci || age > DELETE_FOR_EVERYONE_MAX_AGE_MS) {
          throw new Error('The message cannot be deleted for everyone');
        }
        found.push({ message, conversation, isAdminDelete });
      }
      for (const { message, isAdminDelete } of found) {
        await this.applyDelete(message.authorAci, message.sentAt, isAdminDelete ? account.aci : undefined);
      }
      return found;
    });

    for (const { message, conversation, isAdminDelete } of targets) {
      const targetSentTimestamp = BigInt(message.sentAt);
      await this.sendToConversation(conversation, isAdminDelete ? {
        adminDelete: { targetAuthorAciBinary: uuidToBytes(message.authorAci), targetSentTimestamp },
      } : {
        delete: { targetSentTimestamp },
      }, this.allocateTimestamp(), false);
    }
  }

  /** Deletes messages on this device and tells our other devices (Signal Desktop `ts/util/deleteForMe.preload.ts`) */
  async deleteForMe(messageIds: number[]) {
    const deletes = await this.runSerial(async () => {
      const deletedByConversationId = new Map<string, MessageRecord[]>();
      for (const id of messageIds) {
        const message = await this.db.getMessage(id);
        if (!message) continue;
        await this.removeMessage(message);
        const { conversationId } = message;
        deletedByConversationId.set(conversationId, [...deletedByConversationId.get(conversationId) ?? [], message]);
      }

      const result: { conversation: ConversationRecord; messages: MessageRecord[] }[] = [];
      for (const [conversationId, messages] of deletedByConversationId) {
        const conversation = await this.updateLastMessage(conversationId);
        const addressable = messages.filter(isAddressableMessage);
        if (conversation && addressable.length) result.push({ conversation, messages: addressable });
      }
      return result;
    });
    if (!deletes.length) return;

    await this.syncDeleteForMe({
      messageDeletes: deletes.map(({ conversation, messages }) => ({
        conversation: buildConversationIdentifier(conversation),
        messages: messages.map(buildAddressableMessage),
      })),
    });
  }

  /**
   * Deletes every message of a conversation here and on our other devices, which find the end of the
   * conversation by its latest messages (`destroyMessages` in Signal Desktop `ts/models/conversations.preload.ts`).
   * A conversation without such messages goes as a local-only delete.
   */
  async deleteConversation(conversationId: string) {
    const deleted = await this.runSerial(async () => {
      const conversation = await this.db.getConversation(conversationId);
      if (!conversation) return undefined;
      const latest = await this.db.findLatestMessages(
        conversationId, CONVERSATION_DELETE_MESSAGE_COUNT, isAddressableMessage,
      );
      const latestNonExpiring = latest.some(({ expireTimer }) => expireTimer)
        ? await this.db.findLatestMessages(
          conversationId,
          CONVERSATION_DELETE_MESSAGE_COUNT,
          (message) => isAddressableMessage(message) && !message.expireTimer,
        )
        : undefined;
      await this.deleteMessagesUpTo(conversationId);
      await this.updateLastMessage(conversationId);
      return { conversation, latest, latestNonExpiring };
    });
    if (!deleted) return;

    const { conversation, latest, latestNonExpiring } = deleted;
    const identifier = buildConversationIdentifier(conversation);
    await this.syncDeleteForMe(latest.length ? {
      conversationDeletes: [{
        conversation: identifier,
        mostRecentMessages: latest.map(buildAddressableMessage),
        mostRecentNonExpiringMessages: latestNonExpiring?.map(buildAddressableMessage),
        isFullDelete: true,
      }],
    } : {
      localOnlyConversationDeletes: [{ conversation: identifier }],
    });
  }

  /**
   * Answers a message request here and on our other devices (`syncMessageRequestResponse` and
   * `applyMessageRequestResponse` in Signal Desktop `ts/models/conversations.preload.ts`). Accepting shares our
   * profile key with the contact; a spam report names the contact's latest messages. A changed block also sends
   * the blocked list, as Signal Desktop does besides the storage service write.
   */
  async respondToMessageRequest(conversationId: string, type: MessageRequestResponseType) {
    const account = await this.getAccount();
    const { previous, conversation, spamServerGuids } = await this.runSerial(async () => {
      const found = await this.db.getConversation(conversationId);
      if (!found || found.id === account.aci) throw new Error('The conversation has no message request');
      // A delete removes the messages that the report names, so they are collected first
      const reported = SPAM_RESPONSES.has(type) && found.type === 'private'
        ? await this.db.findLatestMessages(found.id, MAX_SPAM_REPORT_MESSAGES, (message) => (
          !message.isOutgoing && message.authorAci === found.id && Boolean(message.serverGuid)
        ))
        : [];
      const responded = await this.applyMessageRequestResponse(found, type);
      await this.markStorageChanges(getStorageChanges(found, responded, account.aci));
      return {
        previous: found,
        conversation: responded,
        spamServerGuids: reported.map(({ serverGuid }) => serverGuid!),
      };
    });

    const isGroup = conversation.type === 'group';
    await this.sendWhenConnected(async (context) => {
      await sendMessageRequestResponseSync(context, {
        type,
        threadAci: isGroup ? undefined : conversation.id,
        groupId: isGroup ? bufferFromBase64(conversation.id) : undefined,
      });
      if (Boolean(previous.isBlocked) !== Boolean(conversation.isBlocked)) await this.sendBlockedList(context);
      if (spamServerGuids.length) {
        await reportSpam(context.connection, conversation.id, spamServerGuids, conversation.reportingToken);
      }
      if (type === SyncMessage_MessageRequestResponse_Type.ACCEPT && !isGroup) {
        await this.sendToConversation(conversation, {
          flags: DataMessage_Flags.PROFILE_KEY_UPDATE,
        }, this.allocateTimestamp(), false);
      }
    });
  }

  /** Unblocks a conversation without accepting its message request, and sends the blocked list */
  async unblock(conversationId: string) {
    const isChanged = await this.runSerial(async () => {
      const conversation = await this.db.getConversation(conversationId);
      if (!conversation?.isBlocked) return false;
      await this.putLocalConversation(conversation, { ...conversation, isBlocked: false });
      const blockedE164s = await this.client.store.getItem('blockedE164s');
      if (conversation.e164 && blockedE164s?.includes(conversation.e164)) {
        await this.client.store.setItem('blockedE164s', blockedE164s.filter((e164) => e164 !== conversation.e164));
      }
      return true;
    });
    if (isChanged) await this.sendWhenConnected((context) => this.sendBlockedList(context));
  }

  /** Votes in a poll; an empty `optionIndexes` takes the vote back */
  async sendPollVote(messageId: number, optionIndexes: number[]) {
    const account = await this.getAccount();
    const sentAt = this.allocateTimestamp();

    const { conversation, target, voteCount } = await this.runSerial(async () => {
      const message = await this.db.getMessage(messageId);
      const found = message && await this.db.getConversation(message.conversationId);
      if (!message || !found || message.isPollEnded) throw new Error('The poll does not accept votes');
      assertGroupIsOpen(found);
      const count = (message.pollVotes?.find(({ authorAci }) => authorAci === account.aci)?.voteCount ?? 0) + 1;
      await this.putMessage({
        ...message,
        pollVotes: [
          ...(message.pollVotes ?? []).filter(({ authorAci }) => authorAci !== account.aci),
          { authorAci: account.aci, optionIndexes, voteCount: count },
        ],
      });
      return { conversation: found, target: message, voteCount: count };
    });

    await this.sendToConversation(conversation, {
      pollVote: {
        targetAuthorAciBinary: uuidToBytes(target.authorAci),
        targetSentTimestamp: BigInt(target.sentAt),
        optionIndexes,
        voteCount,
      },
    }, sentAt);
  }

  /**
   * Remembers that the CDN no longer has an attachment, an index in `DataMessage.attachments` or the sticker,
   * so it is not downloaded again, and asks the primary device for it (`requestAttachmentBackfill`)
   */
  async markAttachmentUnavailable(messageId: number, attachment: number | 'sticker') {
    await this.runSerial(async () => {
      const message = await this.db.getMessage(messageId);
      if (!message) return;
      if (attachment === 'sticker') {
        if (message.isStickerUnavailable) return;
        await this.requestAttachmentBackfill(await this.putMessage({ ...message, isStickerUnavailable: true }));
        return;
      }
      if (message.unavailableAttachmentIndexes?.includes(attachment)) return;
      await this.requestAttachmentBackfill(await this.putMessage({
        ...message, unavailableAttachmentIndexes: [...message.unavailableAttachmentIndexes ?? [], attachment],
      }));
    });
  }

  /**
   * Asks the primary device for the attachments of a message that the CDN no longer has, as Signal Desktop does
   * (`AttachmentBackfill.request` in `ts/jobs/helpers/attachmentBackfill.preload.ts`): one request at a time for
   * a message, and not again once the phone could not get them or did not answer in time. The response brings new
   * pointers (`applyAttachmentBackfillResponse`). Stories, link previews and quotes have no request.
   */
  private async requestAttachmentBackfill(message: MessageRecord) {
    const { deviceId } = this.client.getSenderContext().account;
    // A primary device keeps the attachments itself, and only addressable messages can be named to it
    if (deviceId === SIGNAL_PRIMARY_DEVICE_ID || !isAddressableMessage(message) || !message.dataMessage) return;
    if (message.isBackfillFailed || this.backfillRequests.has(message.id) || message.deletedAt) return;
    // Pointers that the phone sent failed too: it has nothing better, so this is the end
    if (message.isBackfilled) {
      await this.putMessage({ ...message, isBackfillFailed: true });
      return;
    }
    const conversation = await this.db.getConversation(message.conversationId);
    if (!conversation) return;

    this.armBackfillTimeout(message.id);
    void this.sendWhenConnected(async (context) => {
      await sendAttachmentBackfillRequestSync(context, {
        targetMessage: buildAddressableMessage(message),
        targetConversation: buildConversationIdentifier(conversation),
      });
    }).catch(this.events.onError);
  }

  /** Ends the request for the attachments of a message if the primary device does not answer in time */
  private armBackfillTimeout(messageId: number) {
    clearTimeout(this.backfillRequests.get(messageId));
    this.backfillRequests.set(messageId, setTimeout(() => {
      this.backfillRequests.delete(messageId);
      void this.runSerial(() => this.failAttachmentBackfill(messageId)).catch(this.events.onError);
    }, ATTACHMENT_BACKFILL_TIMEOUT_MS));
  }

  /** The request ran out of time, or the phone gave up: the attachments stay unavailable and are not asked for again */
  private async failAttachmentBackfill(messageId: number) {
    const message = await this.db.getMessage(messageId);
    if (message && !message.isBackfillFailed) await this.putMessage({ ...message, isBackfillFailed: true });
  }

  /**
   * Applies the response to our request for attachments (Signal Desktop `AttachmentBackfill.handleResponse`): the
   * pointers that the primary device sends replace those that failed, and the message shows its media again. An
   * answer that the phone has not finished leaves the request open, an error ends it. Answers to requests of other
   * devices update the pointers too, which is why they are not ignored.
   */
  private async applyAttachmentBackfillResponse(response: SyncMessage_AttachmentBackfillResponse) {
    const conversation = await this.findConversation(response.targetConversation);
    const message = conversation && response.targetMessage
      && await this.findAddressableMessage(conversation.id, response.targetMessage);
    if (!message?.dataMessage) return;

    const isRequested = this.backfillRequests.has(message.id);
    clearTimeout(this.backfillRequests.get(message.id));
    const { data } = response;
    if (data.case !== 'attachments') {
      // The phone does not have the message (`MESSAGE_NOT_FOUND`)
      if (isRequested) {
        this.backfillRequests.delete(message.id);
        await this.failAttachmentBackfill(message.id);
      }
      return;
    }

    const dataMessage = fromBinary(DataMessageSchema, message.dataMessage);
    const downloadedAttachmentIndexes = new Set<number>();
    for (const [index, pointer] of dataMessage.attachments.entries()) {
      if (!message.unavailableAttachmentIndexes?.includes(index) && await getIsAttachmentCached(pointer)) {
        downloadedAttachmentIndexes.add(index);
      }
    }
    const result = applyBackfillResponse({
      dataMessage,
      downloadedAttachmentIndexes,
      isStickerDownloaded: Boolean(dataMessage.sticker?.data && !message.isStickerUnavailable
        && await getIsAttachmentCached(dataMessage.sticker.data)),
      unavailableAttachmentIndexes: message.unavailableAttachmentIndexes ?? [],
      isStickerUnavailable: Boolean(message.isStickerUnavailable),
      isRequested,
      response: data.value,
      longTextContentType: LONG_TEXT_CONTENT_TYPE,
    });
    if (isRequested) {
      // The phone is working on what it has not sent yet; it gets another time to send it
      if (result.pendingCount) this.armBackfillTimeout(message.id);
      else this.backfillRequests.delete(message.id);
    }
    await this.putMessage({
      ...message,
      dataMessage: result.isChanged ? toBinary(DataMessageSchema, result.dataMessage) : message.dataMessage,
      unavailableAttachmentIndexes: result.unavailableAttachmentIndexes.length
        ? result.unavailableAttachmentIndexes
        : undefined,
      isStickerUnavailable: result.isStickerUnavailable || undefined,
      // Attachments that the phone could not get stay unavailable
      isBackfilled: result.isChanged ? true : message.isBackfilled,
      isBackfillFailed: result.failedCount ? true : message.isBackfillFailed,
    });
  }

  /** Ends our own poll */
  async endPoll(messageId: number) {
    const account = await this.getAccount();
    const sentAt = this.allocateTimestamp();

    const { conversation, target } = await this.runSerial(async () => {
      const message = await this.db.getMessage(messageId);
      const found = message && await this.db.getConversation(message.conversationId);
      if (!message || !found || message.authorAci !== account.aci) throw new Error('Only the author ends a poll');
      await this.putMessage({ ...message, isPollEnded: true });
      return { conversation: found, target: message };
    });

    await this.sendToConversation(conversation, {
      pollTerminate: { targetSentTimestamp: BigInt(target.sentAt) },
    }, sentAt);
  }

  /**
   * Marks incoming voice, video and view-once messages viewed, erases opened view-once messages
   * (`markViewOnceMessageViewed` in Signal Desktop `ts/services/MessageUpdater.preload.ts`), and sends
   * viewed receipts (when enabled) and syncs
   */
  async markViewed(messageIds: number[]) {
    const viewedAt = Date.now();
    const viewed = await this.runSerial(async () => {
      const result: { message: MessageRecord; conversation: ConversationRecord; isViewOnce: boolean }[] = [];
      for (const id of messageIds) {
        const message = await this.db.getMessage(id);
        const conversation = message && await this.db.getConversation(message.conversationId);
        if (!message?.dataMessage || !conversation || message.isOutgoing || message.viewedAt) continue;
        const { isViewOnce } = fromBinary(DataMessageSchema, message.dataMessage);
        await this.putMessage({
          ...message,
          viewedAt,
          isViewOnceOpened: isViewOnce || undefined,
          dataMessage: isViewOnce ? undefined : message.dataMessage,
        });
        result.push({ message, conversation, isViewOnce });
      }
      return result;
    });
    if (!viewed.length) return;

    await this.sendWhenConnected(async (context) => {
      if (context.account.isReadReceiptsEnabled) {
        const receipted = viewed
          .filter(({ conversation }) => getIsConversationAccepted(conversation, context.account.aci))
          .map(({ message }) => message);
        for (const [authorAci, timestamps] of groupTimestampsByAuthor(receipted)) {
          await sendReceipts(context, authorAci, ReceiptMessage_Type.VIEWED, timestamps);
        }
      }
      const views = viewed.map(({ message }) => ({ senderAci: message.authorAci, timestamp: message.sentAt }));
      await sendViewedSync(context, views);
      for (const [index, { isViewOnce }] of viewed.entries()) {
        if (isViewOnce) await sendViewOnceOpenSync(context, views[index]);
      }
    });
  }

  /**
   * Sends a typing indicator to a conversation; it reaches only devices online now. Signal sends none while
   * typing indicators are turned off, and none to message requests.
   */
  async sendTyping(conversationId: string, isTyping: boolean) {
    const conversation = await this.db.getConversation(conversationId);
    const context = this.client.getSenderContext();
    if (!conversation || conversation.groupState?.isTerminated || context.account.isTypingIndicatorsEnabled === false
      || !getIsConversationAccepted(conversation, context.account.aci)) {
      return;
    }
    const recipients = getRecipientAcis(conversation, context.account.aci);
    await sendTyping(context, recipients, isTyping, this.getGroupTarget(conversation));
  }

  /**
   * Marks incoming messages of a conversation read up to `maxId`, starts their disappearing timers, and
   * sends read receipts (when enabled) and a read sync
   */
  async markRead(conversationId: string, maxId?: number) {
    const readAt = Date.now();
    const { conversation, messages } = await this.runSerial(async () => {
      const found = await this.db.getConversation(conversationId);
      if (!found) return { conversation: undefined, messages: [] };
      const unread = await this.db.getUnreadMessages(conversationId, maxId);
      for (const message of unread) {
        await this.putMessage({
          ...message,
          readAt,
          expiresAt: message.expireTimer ? readAt + message.expireTimer * 1000 : undefined,
        });
      }
      const remaining = maxId !== undefined ? (await this.db.getUnreadMessages(conversationId)).length : 0;
      await this.putLocalConversation(found, { ...found, unreadCount: remaining, isMarkedUnread: false });
      this.scheduleExpiration();
      return { conversation: found, messages: unread };
    });
    this.flush();
    if (!conversation || !messages.length) return;

    await this.sendWhenConnected(async (context) => {
      if (context.account.isReadReceiptsEnabled && getIsConversationAccepted(conversation, context.account.aci)) {
        for (const [authorAci, timestamps] of groupTimestampsByAuthor(messages)) {
          await sendReceipts(context, authorAci, ReceiptMessage_Type.READ, timestamps);
        }
      }
      const reads = messages.map(({ authorAci, sentAt }) => ({ senderAci: authorAci, timestamp: sentAt }));
      await sendReadSync(context, reads);
    });
  }

  /** The notification profiles and which one is on */
  getNotificationProfiles() {
    return this.runSerial(() => this.notificationProfiles.refresh());
  }

  saveNotificationProfile(draft: NotificationProfileDraft) {
    return this.runSerial(() => this.notificationProfiles.saveProfile(draft));
  }

  deleteNotificationProfile(id: string) {
    return this.runSerial(() => this.notificationProfiles.deleteProfile(id));
  }

  /** Turns a profile on by hand until `endsAt`, or without a profile turns all profiles off by hand */
  setNotificationProfileOverride(profileId: string | undefined, endsAt?: number) {
    return this.runSerial(() => this.notificationProfiles.setOverride(profileId, endsAt));
  }

  /** The calls of the call history that were not cleared, newest first */
  getCallLog(limit: number) {
    return this.db.getCallLog(limit);
  }

  /** Marks the calls as seen here and on our other devices, as Desktop does when the calls list opens */
  markCallLogSeen() {
    return this.runSerial(async () => {
      const newest = await markCallLogSeen(this.callHistory);
      if (!newest) return;
      await this.sendWhenConnected(async (context) => {
        await sendCallLogEventSync(context, {
          type: SyncMessage_CallLogEvent_Type.MARKED_AS_READ,
          timestamp: BigInt(newest.timestamp),
          conversationId: newest.mode === 'group' ? bufferFromBase64(newest.peerId) : uuidToBytes(newest.peerId),
          callId: BigInt(newest.callId),
        });
      }).catch(this.events.onError);
    });
  }

  /**
   * Clears the call history here and on our other devices (Signal Desktop `clearCallHistoryDataAndSync` in
   * `ts/util/callDisposition.preload.ts`). The sync names the newest call, which the other devices clear up to.
   */
  clearCallLog() {
    return this.runSerial(async () => {
      const newest = await clearCallLog(this.callHistory);
      if (!newest) return;
      await this.sendWhenConnected(async (context) => {
        await sendCallLogEventSync(context, {
          type: SyncMessage_CallLogEvent_Type.CLEAR,
          timestamp: BigInt(newest.timestamp),
          conversationId: newest.mode === 'group' ? bufferFromBase64(newest.peerId) : uuidToBytes(newest.peerId),
          callId: BigInt(newest.callId),
        });
      }).catch(this.events.onError);
    });
  }

  /** Stories whose day has not run out, oldest first */
  async getStories() {
    const now = Date.now();
    return (await this.db.getStories()).filter(({ expiresAt }) => expiresAt > now);
  }

  /**
   * Story distribution lists that are not deleted, My Story first. My Story is the list of the storage service: with
   * no record yet, such as after linking, who it goes to is not known, so it is left out instead of defaulting to
   * every connection.
   */
  async getStoryDistributionLists() {
    const stored = await this.client.store.getItem('storyDistributionLists') ?? [];
    const lists = stored.filter(({ deletedAt }) => !deletedAt);
    return [...lists.filter(({ id }) => id === MY_STORY_ID), ...lists.filter(({ id }) => id !== MY_STORY_ID)];
  }

  /**
   * Marks a story viewed and sends a viewed receipt (when story view receipts are on) and a viewed sync
   * (Signal Desktop `markViewed` with stories in `ts/services/MessageUpdater.preload.ts`)
   */
  async markStoryViewed(storyId: number) {
    const viewed = await this.runSerial(async () => {
      const story = await this.db.getStory(storyId);
      if (!story || story.isOutgoing || story.viewedAt) return undefined;
      return this.putStory({ ...story, viewedAt: Date.now() });
    });
    if (!viewed) return;

    // Stories of an author we blocked since stay until they expire, but the author learns nothing from viewing them
    const isAuthorBlocked = Boolean((await this.db.getConversation(viewed.authorAci))?.isBlocked);
    await this.sendWhenConnected(async (context) => {
      if (getAreStoryViewReceiptsEnabled(context.account) && !isAuthorBlocked) {
        await sendReceipts(context, viewed.authorAci, ReceiptMessage_Type.VIEWED, [viewed.sentAt]);
      }
      await sendViewedSync(context, [{ senderAci: viewed.authorAci, timestamp: viewed.sentAt }]);
    });
  }

  /**
   * Sends a story to distribution lists and groups (Signal Desktop `ts/util/sendStoryMessage.preload.ts` and
   * `ts/jobs/helpers/sendStory.preload.ts`). The lists share one story with one timestamp: each person gets it once,
   * and may reply when any of their lists allows replies. Each group gets a story of its own. Our other devices learn
   * about each story with its recipients. Returns the stored stories.
   */
  async sendStory(story: OutgoingStory, { listIds = [], groupIds = [] }: { listIds?: string[]; groupIds?: string[] }) {
    const account = await this.getAccount();
    if (account.isStoriesDisabled) throw new Error('Stories are turned off');
    const lists = (await this.getStoryDistributionLists()).filter(({ id }) => listIds.includes(id));
    if (listIds.includes(MY_STORY_ID) && !lists.some(({ id }) => id === MY_STORY_ID)) {
      throw new Error('My Story has not been synced yet');
    }
    const conversations = await this.db.getConversations();
    const groups = conversations.filter(({ id, type }) => type === 'group' && groupIds.includes(id));
    const sent: StoryRecord[] = [];

    if (lists.length) {
      const listStory = await this.sendListStory(account, story, lists, conversations);
      if (listStory) sent.push(listStory);
    }
    for (const group of groups) {
      // Signal Desktop `sendStoryMessage` skips groups where only admins may send. Stories carry our profile key, so
      // they do not go to groups that are blocked or that we have not accepted.
      if (group.isAnnouncementsOnly && !group.adminAcis?.includes(account.aci)) continue;
      if (group.isBlocked || group.groupState?.isTerminated || !getIsConversationAccepted(group, account.aci)) continue;
      sent.push(await this.sendGroupStory(account, story, group));
    }

    // A story that reached nobody is not kept, so that it can be sent again
    const isDelivered = ({ recipients }: StoryRecord) => (
      Object.values(recipients ?? {}).some(({ status }) => status !== 'failed')
    );
    const delivered = sent.filter(isDelivered);
    for (const failed of sent.filter((sentStory) => !delivered.includes(sentStory))) {
      await this.runSerial(() => this.removeStory(failed));
    }
    if (!delivered.length) {
      throw new Error(sent.length ? 'The story reached nobody' : 'There is nobody to send the story to');
    }
    return delivered;
  }

  /**
   * Deletes our story for everyone: a group story with a delete to the group, a list story with a delete to each
   * recipient and a recipient update that tells our other devices nobody has it (Signal Desktop
   * `ts/util/deleteStoryForEveryone.preload.ts`). Resolves with `isPartial` when the delete did not reach everyone.
   */
  async deleteStoryForEveryone(storyId: number): Promise<{ isPartial: boolean }> {
    const story = await this.db.getStory(storyId);
    if (!story?.isOutgoing) throw new Error('Only our own stories can be deleted for everyone');
    const conversation = await this.db.getConversation(story.conversationId);

    // The story stays until the delete went out, so a failed delete can be tried again; a delete that finds no
    // connection waits for the next one
    if (conversation?.type === 'group') {
      const isSent = await this.sendToConversation(conversation, {
        delete: { targetSentTimestamp: BigInt(story.sentAt) },
      }, this.allocateTimestamp(), false);
      if (!isSent) throw new Error('The delete did not reach the group');
      await this.runSerial(() => this.removeStory(story));
      return { isPartial: false };
    }

    const recipients = Object.entries(story.recipients ?? {});
    let isPartial = false;
    await this.sendWhenConnected(async (context) => {
      const results = await sendStoryDelete(context, recipients.map(([aci]) => aci), story.sentAt);
      if (results.length && results.every(({ error }) => error)) throw results[0].error!;
      isPartial = results.some(({ error }) => error);
      await sendStorySync(context, {
        timestamp: story.sentAt,
        storyMessageRecipients: recipients.map(([aci, { isAllowedToReply }]) => ({
          destinationServiceId: aci, distributionListIds: [], isAllowedToReply,
        })),
        isRecipientUpdate: true,
      });
    });
    await this.runSerial(() => this.removeStory(story));
    return { isPartial };
  }

  /**
   * Replies to a story, or reacts to it with `emoji`. Group story replies go to the group and stay with the story;
   * replies to a contact's story go to the private conversation as messages that name the story, as in Signal.
   */
  async sendStoryReply(storyId: number, reply: StoryReplyContent) {
    const story = await this.db.getStory(storyId);
    const conversation = story && await this.db.getConversation(story.conversationId);
    if (!story || !conversation) throw new Error(`Unknown story ${storyId}`);
    const { allowsReplies } = fromBinary(StoryMessageSchema, story.storyMessage);
    if (!allowsReplies && conversation.type !== 'group') throw new Error('The story does not allow replies');

    const storyContext = { authorAciBinary: uuidToBytes(story.authorAci), sentTimestamp: BigInt(story.sentAt) };
    const reaction = reply.emoji ? {
      emoji: reply.emoji,
      targetAuthorAciBinary: uuidToBytes(story.authorAci),
      targetSentTimestamp: BigInt(story.sentAt),
    } : undefined;
    const init = {
      body: reply.body, bodyRanges: reply.bodyRanges, storyContext, reaction,
    };

    const account = await this.getAccount();
    if (conversation.type !== 'group') {
      const message = await this.sendDataMessage(conversation.id, init);
      await this.runSerial(async () => {
        const current = await this.db.getStory(story.id);
        if (current) {
          await this.addStoryReply(current, {
            authorAci: account.aci, sentAt: message.sentAt, body: reply.body, emoji: reply.emoji,
          });
        }
      });
      return;
    }

    // The reply stays with the story once the group got it
    const sentAt = this.allocateTimestamp();
    if (!await this.sendToConversation(conversation, init, sentAt, true, true)) {
      throw new Error('The reply did not reach the group');
    }
    await this.runSerial(async () => {
      const current = await this.db.getStory(story.id);
      if (current) {
        await this.addStoryReply(current, {
          authorAci: account.aci, sentAt, body: reply.body, emoji: reply.emoji,
        });
      }
    });
  }

  /** Hides or shows the stories of a contact or a group; other devices learn it through the storage service */
  setStoryHidden(conversationId: string, isHidden: boolean) {
    return this.runSerial(async () => {
      const conversation = await this.db.getConversation(conversationId);
      return conversation && this.putLocalConversation(conversation, {
        ...conversation, isStoryHidden: isHidden || undefined,
      });
    });
  }

  /**
   * Turns stories off or on, or story view receipts, in the account record. Turning stories off removes the stories
   * stored here, as Signal Desktop no longer shows them.
   */
  updateStorySettings(update: Partial<Pick<AccountRecord, 'isStoriesDisabled' | 'isStoryViewReceiptsEnabled'>>) {
    return this.runSerial(async () => {
      // A setting that is not given stays as it is
      const { isStoriesDisabled, isStoryViewReceiptsEnabled } = update;
      const fields: StorageChanges[string] = [];
      const changes: typeof update = {};
      if (isStoriesDisabled !== undefined) {
        fields.push('storiesDisabled');
        changes.isStoriesDisabled = isStoriesDisabled;
      }
      if (isStoryViewReceiptsEnabled !== undefined) {
        fields.push('storyViewReceiptsEnabled');
        changes.isStoryViewReceiptsEnabled = isStoryViewReceiptsEnabled;
      }
      const account = await this.client.updateAccount(changes);
      await this.markStorageChanges({ [ACCOUNT_KEY]: fields });
      if (isStoriesDisabled) await this.removeAllStories();
      return account;
    });
  }

  /** Creates or changes a story distribution list; the storage service record is written from it */
  saveStoryDistributionList(list: StoryDistributionList) {
    return this.runSerial(async () => {
      const { store } = this.client;
      const lists = await store.getItem('storyDistributionLists') ?? [];
      const previous = lists.find(({ id }) => id === list.id);
      // My Story is written only from the record of the storage service, never from defaults
      if (list.id === MY_STORY_ID && !previous) throw new Error('My Story has not been synced yet');
      // Members known by PNI only are not shown in the app, so they stay while the audience keeps its meaning, such
      // as when other fields of the list change; switching between excluding and including people, or to all
      // connections from a list of people, starts without them
      const getIsAllConnections = (item?: StoryDistributionList) => (
        Boolean(item?.isBlockList && !item.memberAcis.length)
      );
      const isAudienceChanged = previous?.isBlockList !== list.isBlockList
        || (getIsAllConnections(list) && !getIsAllConnections(previous));
      const keptMemberIds = isAudienceChanged ? undefined : previous?.otherMemberIds;
      const saved = { ...list, otherMemberIds: list.otherMemberIds ?? keptMemberIds };
      await store.setItem('storyDistributionLists', [...lists.filter(({ id }) => id !== list.id), saved]);
      await this.markStorageChanges({ [getStoryListKey(list.id)]: ['storyDistributionList'] });
      return saved;
    });
  }

  /** Deletes a custom list; the record stays deleted for other devices, as Signal Desktop writes it */
  async deleteStoryDistributionList(id: string) {
    if (id === MY_STORY_ID) throw new Error('My Story cannot be deleted');
    const list = (await this.client.store.getItem('storyDistributionLists'))?.find((item) => item.id === id);
    if (!list) return;
    await this.saveStoryDistributionList({ ...list, memberAcis: [], otherMemberIds: [], deletedAt: Date.now() });
  }

  /**
   * Reads the storage service and writes the local changes of its records, one sync at a time
   * (see `syncStorageService`)
   */
  syncStorage() {
    const { generation } = this;
    const sync = this.storageSync.then(() => (
      generation === this.generation ? syncStorageService(this.client.getSenderContext(), this) : undefined
    ));
    this.storageSync = sync.catch(() => undefined);
    return sync;
  }

  /**
   * Merges stored storage records of types and fields this device learned to handle after storing them, once per
   * pass of `STORAGE_MERGE_PASSES`. Records are fetched only when new, so what is supported later would otherwise stay
   * unread until another device rewrites the record (Signal Desktop reprocesses its unknown records after an upgrade
   * the same way). Fields changed here since the last write keep their local values.
   */
  mergeStoredRecordsOfNewTypes() {
    return this.runSerial(async () => {
      const { store } = this.client;
      const merged = new Set(await store.getItem('storageMergedRecordTypes'));
      const passes = STORAGE_MERGE_PASSES.filter(({ id }) => !merged.has(id));
      if (!passes.length) return;
      const types = new Set(passes.flatMap(({ cases }) => cases));

      const stored = await store.getItem('storageManifest');
      if (stored) {
        const records = (await store.getStorageRecords(getManifestIds(fromBinary(ManifestRecordSchema, stored))))
          .filter(Boolean)
          .map((record) => fromBinary(StorageRecordSchema, record))
          .filter(({ record }) => record.case && types.has(record.case));
        if (records.length) await this.mergeStorageRecords(records, false);
      }
      await store.setItem('storageMergedRecordTypes', [...merged, ...passes.map(({ id }) => id)]);
    });
  }

  /**
   * Merges a newer storage manifest: records new to this device go into the local state, except for fields changed
   * here since the last write, and are stored with the manifest for later writes
   */
  applyStorageManifest(manifest: ManifestRecord, records: Map<string, Uint8Array<ArrayBuffer>>) {
    return this.runSerial(async () => {
      const { store } = this.client;
      const stored = await store.getItem('storageManifest');
      const previousIds = new Set(stored && getManifestIds(fromBinary(ManifestRecordSchema, stored)));
      const ids = new Set(getManifestIds(manifest));

      await this.mergeStorageRecords(
        [...records.values()].map((record) => fromBinary(StorageRecordSchema, record)), !stored,
      );
      await store.setStorageRecords(records);
      await store.removeStorageRecords([...previousIds].filter((id) => !ids.has(id)));
      // Ids the server has no record for are left out, so the next write drops them
      const merged = clone(ManifestRecordSchema, manifest);
      merged.identifiers = manifest.identifiers.filter(({ raw }) => {
        const id = bufferToBase64(raw);
        return records.has(id) || previousIds.has(id);
      });
      await store.setItem('storageManifest', toBinary(ManifestRecordSchema, merged));
    });
  }

  /** The write of local record changes on top of the stored manifest, see `buildStorageWrite` */
  buildStorageWrite() {
    return this.runSerial(async (): Promise<PendingStorageWrite | undefined> => {
      const { store } = this.client;
      const stored = await store.getItem('storageManifest');
      const changes = await store.getItem('storageChanges');
      // The primary device creates the first manifest
      if (!stored || !changes || !Object.keys(changes).length) return undefined;

      const account = await this.getAccount();
      const manifest = fromBinary(ManifestRecordSchema, stored);
      const records = await this.getStoredRecords(manifest);
      const profileKeys = new Map<string, Uint8Array>();
      for (const id of Object.keys(changes)) {
        const profileKey = id !== ACCOUNT_KEY ? (await store.getRecipient(id))?.profileKey : undefined;
        if (profileKey) profileKeys.set(id, profileKey);
      }

      const built = buildStorageWrite({
        manifest,
        records,
        changes,
        conversations: await this.db.getConversations(),
        stickerPacks: await store.getItem('stickerPacks') ?? {},
        profileKeys,
        selfAci: account.aci,
        deviceId: account.deviceId,
        localAccount: account,
        storyLists: await store.getItem('storyDistributionLists') ?? [],
        notificationProfiles: await store.getItem('notificationProfiles') ?? [],
        notificationProfileOverride: await store.getItem('notificationProfileOverride'),
      });
      if (!built) return undefined;

      const accountFields = built.writtenKeys.includes(ACCOUNT_KEY) ? changes[ACCOUNT_KEY] : undefined;
      return {
        ...built,
        changeCount: this.storageChangeCount,
        // The username counts once the account record, which carries it, is written
        hasUsernameChange: Boolean(accountFields?.includes('username')),
      };
    });
  }

  /**
   * How many conversations are pinned, in the chat list and in the account record of the storage service, where
   * other devices may pin conversations that this one does not have
   */
  async countPinnedConversations() {
    const stored = await this.client.store.getItem('storageManifest');
    const records = stored ? await this.getStoredRecords(fromBinary(ManifestRecordSchema, stored)) : new Map();
    return countPinnedConversations(records, await this.db.getConversations());
  }

  /**
   * A write of a whole new manifest at `version` (see `buildNewStorageWrite`). With `shouldClearAll`, the records of
   * the manifest that it replaces are dropped from this device when the write is committed.
   */
  buildNewStorageWrite(version: bigint, shouldClearAll: boolean) {
    return this.runSerial(async (): Promise<PendingStorageWrite> => {
      const { store } = this.client;
      const account = await this.getAccount();
      const conversations = await this.db.getConversations();
      const profileKeys = new Map<string, Uint8Array>();
      for (const { id, type } of conversations) {
        const profileKey = type === 'private' ? (await store.getRecipient(id))?.profileKey : undefined;
        if (profileKey) profileKeys.set(id, profileKey);
      }

      const built = buildNewStorageWrite({
        version,
        shouldClearAll,
        conversations,
        stickerPacks: await store.getItem('stickerPacks') ?? {},
        profileKeys,
        selfAci: account.aci,
        deviceId: account.deviceId,
        localAccount: account,
      });
      return { ...built, changeCount: this.storageChangeCount, hasUsernameChange: false };
    });
  }

  /** Stores the records of an accepted write and clears the changes it carried */
  commitStorageWrite({ write, writtenKeys, changeCount }: PendingStorageWrite) {
    return this.runSerial(async () => {
      const { store } = this.client;
      const stored = await store.getItem('storageManifest');
      if (write.shouldClearAll && stored) {
        await store.removeStorageRecords(getManifestIds(fromBinary(ManifestRecordSchema, stored)));
      }
      await store.setStorageRecords(write.inserts);
      await store.removeStorageRecords(write.deleteIds);
      await store.setItem('storageManifest', toBinary(ManifestRecordSchema, write.manifest));
      // Changes made while the write was on its way go out again with the next one
      if (changeCount !== this.storageChangeCount) return;
      const written = new Set(writtenKeys);
      const changes = await store.getItem('storageChanges') ?? {};
      await store.setItem(
        'storageChanges',
        Object.fromEntries(Object.entries(changes).filter(([key]) => !written.has(key))),
      );
    });
  }

  /** Changes how a conversation is listed; other devices learn it through the storage service */
  updateConversationState(
    id: string, update: Partial<Pick<ConversationRecord, 'isArchived' | 'isMarkedUnread' | 'mutedUntil' | 'pinIndex'>>,
  ) {
    return this.runSerial(async () => {
      const conversation = await this.db.getConversation(id);
      return conversation && this.putLocalConversation(conversation, { ...conversation, ...update });
    });
  }

  /**
   * Stores what this device changed in our profile. The profile itself carries it to other devices, and the
   * account record of the storage service gets our names and the avatar path (Signal Desktop `toAccountRecord`).
   */
  updateOwnConversation(update: Partial<Pick<
    ConversationRecord, 'profileName' | 'profileFamilyName' | 'about' | 'aboutEmoji' | 'avatarPath'
  >>) {
    return this.runSerial(async () => {
      const account = await this.getAccount();
      const conversation = await this.ensurePrivateConversation(account.aci);
      const updated = await this.putConversation({ ...conversation, ...update });
      await this.markStorageChanges({ [ACCOUNT_KEY]: PROFILE_STORAGE_FIELDS });
      return updated;
    });
  }

  /**
   * Stores our username, its link or phone number privacy changed on this device, and writes them to the account
   * record of the storage service. The username is on our private conversation, the rest on the account.
   */
  updateOwnAccount(update: OwnAccountUpdate) {
    return this.runSerial(async () => {
      const { username, ...accountUpdate } = update;
      const account = await this.client.updateAccount(accountUpdate);
      if ('username' in update) {
        const self = await this.ensurePrivateConversation(account.aci);
        await this.putConversation({ ...self, username });
      }
      const fields = (Object.keys(update) as (keyof OwnAccountUpdate)[]).map((key) => OWN_ACCOUNT_FIELDS[key]);
      await this.markStorageChanges({ [ACCOUNT_KEY]: fields });
    });
  }

  /**
   * Changes receipts, typing indicators, link previews, sealed sender indicators or the timer of new chats. They
   * go to the account record of the storage service, which other devices read, and a primary device also tells the
   * devices it linked, as Signal Android does with `MultiDeviceConfigurationUpdateJob`.
   */
  async updateMessageSettings(update: MessageSettingsUpdate) {
    await this.updateOwnAccount(update);
    const account = await this.getAccount();
    if (account.deviceId === SIGNAL_PRIMARY_DEVICE_ID) await this.sendConfiguration(account);
  }

  /** Stores the username of a contact that a username lookup found */
  setConversationUsername(aci: string, username: string) {
    return this.runSerial(async () => {
      const conversation = await this.ensurePrivateConversation(aci);
      return this.putConversation({ ...conversation, username });
    });
  }

  /**
   * Installs or removes a sticker pack on this device. Other devices learn it from a `stickerPackOperation` sync and
   * the pack's storage service record (Signal Desktop `installStickerPack` in `ts/state/ducks/stickers.preload.ts`).
   */
  async setStickerPackInstalled(id: string, key: string, isInstalled: boolean) {
    const isChanged = await this.runSerial(async () => {
      const state: StickerPackState = isInstalled ? { isInstalled: true } : { uninstalledAt: Date.now() };
      if (!await this.applyStickerPackState(id, key, state)) return false;
      await this.markStorageChanges({ [getStickerPackStorageKey(id)]: ['stickerPack'] });
      return true;
    });
    if (!isChanged) return;
    await this.sendWhenConnected(async (context) => {
      await sendStickerPackSync(context, [{ id, key, isInstalled }]);
    });
  }

  /**
   * Fetches the profile behind a private conversation and stores its decrypted fields. Our own profile key
   * is in the account, other profile keys are in their recipients.
   */
  async refreshProfile(aci: string) {
    const {
      store, connection, unauthenticatedChat, account,
    } = this.client.getSenderContext();
    const profileKey = aci === account.aci ? account.profileKey : (await store.getRecipient(aci))?.profileKey;
    if (!profileKey) return;

    // Other users' profiles are fetched without account credentials, unless they turned sealed sender off
    const accessKey = aci === account.aci ? undefined : await getAccessKey(store, aci);
    const unauthenticated = accessKey ? { chat: unauthenticatedChat, accessKey } : undefined;
    let profile;
    try {
      profile = await fetchProfile(connection, aci, profileKey, unauthenticated);
    } catch (err) {
      if (!(err instanceof ProfileNotFoundError) || aci === account.aci) throw err;
      // Our profile key of this user is out of date, or they deleted their account: keep the identity key current and
      // try again after the usual interval instead of on every connection
      const identityKey = await fetchProfileIdentityKey(connection, aci, unauthenticated);
      if (identityKey) await store.runExclusive(() => saveIdentity(store, aci, identityKey));
      await this.runSerial(async () => {
        await this.putConversation({ ...await this.ensurePrivateConversation(aci), profileFetchedAt: Date.now() });
      });
      return;
    }
    if (profile.hasUnrestrictedUnidentifiedAccess) {
      await store.updateRecipient(aci, { sealedSender: 'unrestricted' });
    }
    // Signal Desktop `updateIdentityKey` in `ts/services/profiles.preload.ts`: the profile shows a changed key
    // before a message does, and gives the safety number of users we have no session with
    const { identityKey } = profile;
    if (identityKey && aci !== account.aci) await store.runExclusive(() => saveIdentity(store, aci, identityKey));
    await this.runSerial(async () => {
      const conversation = await this.ensurePrivateConversation(aci);
      await this.putConversation({
        ...conversation,
        profileName: profile.givenName,
        profileFamilyName: profile.familyName,
        about: profile.about,
        aboutEmoji: profile.aboutEmoji,
        avatarPath: profile.avatarPath,
        profileFetchedAt: Date.now(),
      });
    });
    this.flush();
  }

  /**
   * Fetches the profiles of up to 50 private conversations whose profile is missing or older than three days,
   * most recently active first (Signal Desktop `routineProfileRefresh`). Conversations created before the
   * connection, such as those from history transfer or storage service, get their names and avatars this way.
   */
  async refreshStaleProfiles() {
    const { store, account } = this.client.getSenderContext();
    const now = Date.now();
    const candidates = (await this.db.getConversations())
      .filter(({ id, type, profileFetchedAt }) => (
        type === 'private' && id !== account.aci && (!profileFetchedAt || now - profileFetchedAt > PROFILE_MAX_AGE_MS)
      ))
      .sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));

    let count = 0;
    for (const { id } of candidates) {
      if (count >= MAX_PROFILES_TO_REFRESH) break;
      // Profiles without a known profile key cannot be decrypted
      if (!(await store.getRecipient(id))?.profileKey) continue;
      count++;
      this.queueProfileRefresh(id);
    }
    await this.profileQueue;
  }

  /**
   * Adds a safety number change notice to the private conversation with `aci` and to the groups we share
   * (Signal Desktop `addKeyChange` in `ts/models/conversations.preload.ts`). `SignalStore.onIdentityChange` calls it.
   */
  addSafetyNumberChange(aci: string) {
    return this.runSerial(async () => {
      const account = await this.getAccount();
      if (aci === account.aci) return;
      await this.addIdentityNotices(aci, { kind: 'safetyNumberChange' });
    });
  }

  /**
   * Marks the safety number with `aci` as verified, or clears the verification, and tells our other devices
   * (Signal Desktop `toggleVerified` and `getVerificationSync`)
   */
  async setVerified(aci: string, isVerified: boolean) {
    const { store } = this.client;
    const state = isVerified ? Verified_State.VERIFIED : Verified_State.DEFAULT;
    const identity = await store.runExclusive(async () => {
      const current = await store.getIdentity(aci);
      if (!current) throw new Error(`No identity key of ${aci}`);
      if ((current.verified ?? Verified_State.DEFAULT) === state) return undefined;
      await store.setIdentity(aci, { ...current, verified: state });
      return current;
    });
    if (!identity) return;

    await this.runSerial(() => this.addIdentityNotices(aci, { kind: 'verifiedChange', isVerified }));
    await this.sendWhenConnected(async (context) => {
      await sendVerifiedSync(context, { destinationAci: aci, identityKey: identity.publicKey, state });
    });
  }

  /**
   * The recipients that a failed message did not reach because their safety number changed: sends to them fail
   * until their identity is verified or set to default again (see `isTrustedIdentity`)
   */
  async getUnverifiedRecipients(messageId: number) {
    const message = await this.db.getMessage(messageId);
    const unverified: string[] = [];
    for (const [aci, status] of Object.entries(message?.recipientStatus ?? {})) {
      if (status === 'failed' && (await this.client.store.getIdentity(aci))?.verified === Verified_State.UNVERIFIED) {
        unverified.push(aci);
      }
    }
    return unverified;
  }

  /**
   * Accepts the new safety numbers of the recipients a message failed to reach and sends it to the failed ones again
   * (Signal Desktop `verifyConversationsStoppingSend`): an unverified identity becomes default, which our other
   * devices learn, and a verified one stays verified.
   */
  async sendMessageAnyway(messageId: number) {
    for (const aci of await this.getUnverifiedRecipients(messageId)) await this.setVerified(aci, false);
    return this.resendMessage(messageId);
  }

  /**
   * Sends an outgoing message again to the recipients it failed for, as pending until the send ends (Signal Desktop
   * `retryMessageSend`). Members of a group whose accounts are gone are not tried again. Returns `undefined` when no
   * recipient is left to try, or the message is being sent.
   */
  async resendMessage(messageId: number) {
    const prepared = await this.runSerial(async () => {
      const message = await this.db.getMessage(messageId);
      const conversation = message && await this.db.getConversation(message.conversationId);
      if (!message?.isOutgoing || !message.dataMessage || !conversation) {
        throw new Error('The message cannot be sent again');
      }
      if (this.sendsInFlight.has(messageId)) return undefined;

      const failed = getFailedRecipients(message, conversation);
      return failed.length ? this.prepareResend(message, conversation, failed) : undefined;
    });
    return prepared && this.sendPrepared(prepared);
  }

  /**
   * Sends the messages again that earlier sends left undelivered: recipients that are still pending after a reload or
   * a crash, and those that failed for lack of a connection (Signal Desktop `sendNormalMessage` runs in a job that
   * `ts/jobs/conversationJobQueue.preload.ts` retries with a growing pause for a day). The messages keep their
   * timestamps, so recipients that got one already ignore it. After the day, pending recipients fail. A pass with
   * `isForced` ignores the pauses, as after a connection; the others run when the pause of the first message ends.
   */
  private retryUnsentMessages(isForced?: boolean) {
    const { generation } = this;
    this.retryPass = this.retryPass
      .then(() => this.runRetryPass(generation, isForced))
      .catch(this.events.onError);
  }

  private async runRetryPass(generation: number, isForced?: boolean) {
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;

    for (const { id, sendRetry } of await this.db.getMessagesToRetry()) {
      if (generation !== this.generation) return;
      // The send of a message in flight sets its next retry; a message waits for the connection otherwise
      if (this.sendsInFlight.has(id)) continue;
      if (!isForced && sendRetry!.at > Date.now()) continue;
      if (!this.client.isConnected) return;
      await this.retryMessage(id, isForced).catch(this.events.onError);
    }
    if (generation === this.generation) await this.scheduleSendRetry();
  }

  private async retryMessage(messageId: number, isForced?: boolean) {
    const prepared = await this.runSerial(async () => {
      // The pass chose the message before this ran: a send may have started or finished meanwhile
      if (this.sendsInFlight.has(messageId)) return undefined;
      const message = await this.db.getMessage(messageId);
      if (!message?.sendRetry || (!isForced && message.sendRetry.at > Date.now())) return undefined;

      const conversation = await this.db.getConversation(message.conversationId);
      const recipients = conversation && message.isOutgoing && message.dataMessage && !message.deletedAt
        ? getRetryRecipients(message, conversation)
        : [];
      if (!conversation || !recipients.length || Date.now() - message.sendRetry.startedAt > SEND_RETRY_MAX_AGE_MS) {
        await this.finishSendRetry(message);
        return undefined;
      }
      return this.prepareResend(message, conversation, recipients);
    });
    if (prepared) await this.sendPrepared(prepared);
  }

  /** Gives up on a message: the recipients it is still pending for failed for lack of a connection */
  private async finishSendRetry(message: MessageRecord) {
    const recipientStatus = { ...message.recipientStatus };
    const recipientErrors = { ...message.recipientErrors };
    for (const [aci, status] of Object.entries(recipientStatus)) {
      if (status !== 'pending') continue;
      recipientStatus[aci] = 'failed';
      recipientErrors[aci] = 'network';
    }
    await this.putMessage({
      ...message, recipientStatus, recipientErrors: Object.keys(recipientErrors).length ? recipientErrors : undefined,
      sendRetry: undefined,
    });
  }

  private markSendStarted(messageId: number) {
    this.sendsInFlight.set(messageId, (this.sendsInFlight.get(messageId) ?? 0) + 1);
  }

  private markSendEnded(messageId: number) {
    const count = (this.sendsInFlight.get(messageId) ?? 0) - 1;
    if (count > 0) this.sendsInFlight.set(messageId, count);
    else this.sendsInFlight.delete(messageId);
  }

  /** Marks `recipients` pending and the message as being sent; `sendPrepared` sends it */
  private async prepareResend(message: MessageRecord, conversation: ConversationRecord, recipients: string[]) {
    const recipientStatus = { ...message.recipientStatus };
    const recipientErrors = { ...message.recipientErrors };
    for (const aci of recipients) {
      recipientStatus[aci] = 'pending';
      delete recipientErrors[aci];
    }
    const pending = await this.putMessage({
      ...message, recipientStatus, recipientErrors: Object.keys(recipientErrors).length ? recipientErrors : undefined,
    });
    this.markSendStarted(message.id);
    return { conversation, message: pending, recipients };
  }

  private sendPrepared(
    { conversation, message, recipients }:
    { conversation: ConversationRecord; message: MessageRecord; recipients: string[] },
  ) {
    const dataMessage = fromBinary(DataMessageSchema, message.dataMessage!);
    // An edited message shows the send state of its latest edit, so that edit goes again
    const content: OutgoingMessage = message.editedAt
      ? { case: 'editMessage', value: { targetSentTimestamp: BigInt(message.sentAt), dataMessage } }
      : { case: 'dataMessage', value: dataMessage };
    return this.sendStoredMessage(conversation, message, content, {
      timestamp: message.editedAt ?? message.sentAt,
      expirationStartTimestamp: message.expireTimer ? message.sentAt : undefined,
    }, recipients);
  }

  /** Runs the next retry pass when the earliest pause of a message ends */
  private async scheduleSendRetry() {
    const [next] = (await this.db.getMessagesToRetry()).filter(({ id }) => !this.sendsInFlight.has(id));
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    if (!next) return;
    // The minimum keeps a pass that cannot change a message from running over and over
    const delay = Math.max(next.sendRetry!.at - Date.now(), MIN_SEND_RETRY_TIMER_MS);
    this.retryTimer = setTimeout(() => this.retryUnsentMessages(), Math.min(delay, MAX_TIMEOUT_MS));
  }

  /**
   * Stores transferred message history (`backups/importBackup.ts`): the conversation fields first, creating absent
   * conversations, then the messages in order. A message whose author and timestamp are stored already is skipped,
   * so an interrupted import can run again. Nothing goes to `onChanges`: the import ends before the app lists chats,
   * and the app loads them from the database. Returns the number of stored messages.
   */
  importHistory({ conversations, messages, isMerge }: HistoryBatch) {
    return this.runSerial(async () => {
      const updated = new Map<string, ConversationRecord>();
      let nextLocalId: number | undefined;
      const getConversation = async (id: string) => updated.get(id) ?? this.db.getConversation(id);

      for (const patch of conversations) {
        const existing = await getConversation(patch.id);
        if (!existing) nextLocalId ??= await this.db.allocateLocalId();
        updated.set(patch.id, {
          ...existing ?? { localId: nextLocalId!++, unreadCount: 0 },
          ...isMerge && existing ? getAbsentFields(existing, patch) : patch,
        });
      }

      const added = await this.db.addMessagesIfAbsent(messages.map(({ record }) => record));
      for (const [index, message] of added.entries()) {
        if (!message) continue;
        const conversation = await getConversation(message.conversationId);
        if (!conversation) throw new Error(`Imported message of unknown conversation ${message.conversationId}`);
        const { pin } = messages[index];
        const isUnread = !message.isOutgoing && !message.readAt && message.kind === 'message';
        const isNewest = !isMerge || !conversation.lastMessageAt || message.sentAt >= conversation.lastMessageAt;
        updated.set(conversation.id, {
          ...conversation,
          lastMessageId: isNewest ? message.id : conversation.lastMessageId,
          lastMessageAt: isNewest ? message.sentAt : conversation.lastMessageAt,
          unreadCount: conversation.unreadCount + (isUnread ? 1 : 0),
          pinnedMessages: pin
            ? [...conversation.pinnedMessages ?? [], { ...pin, messageId: message.id }]
            : conversation.pinnedMessages,
        });
      }

      await this.db.putConversations([...updated.values()]);
      if (added.some((message) => message?.expiresAt)) this.scheduleExpiration();
      return added.filter(Boolean).length;
    });
  }

  /**
   * Sends receipts or syncs for a local change now, or after the next connection while there is none.
   * A send that fails because the connection closed meanwhile waits for the next one as well.
   */
  private async sendWhenConnected(send: (context: SenderContext) => Promise<void>) {
    const { generation } = this;
    if (!this.client.isConnected) {
      this.pendingSends.push(send);
      return;
    }
    try {
      await send(this.client.getSenderContext());
    } catch (err) {
      if (this.client.isConnected) throw err;
      if (generation === this.generation) this.pendingSends.push(send);
    }
  }

  private async flushPendingSends() {
    const { generation } = this;
    for (const send of this.pendingSends.splice(0)) {
      if (generation !== this.generation) return;
      await this.sendWhenConnected(send).catch(this.events.onError);
    }
  }

  private queueProfileRefresh(aci: string) {
    const { generation } = this;
    this.profileQueue = this.profileQueue
      .then(() => (generation === this.generation ? this.refreshProfile(aci) : undefined))
      .catch(this.events.onError);
  }

  /** The stored records of a manifest, serialized, by base64 storage id */
  private async getStoredRecords(manifest: ManifestRecord) {
    const ids = getManifestIds(manifest);
    const serialized = await this.client.store.getStorageRecords(ids);
    const records = new Map<string, Uint8Array>();
    ids.forEach((id, index) => {
      if (serialized[index]) records.set(id, serialized[index]);
    });
    return records;
  }

  /** Runs a storage service sync after `STORAGE_SYNC_DELAY_MS`, or after the next connection while there is none */
  private scheduleStorageSync() {
    clearTimeout(this.storageSyncTimer);
    this.storageSyncTimer = setTimeout(() => {
      this.storageSyncTimer = undefined;
      if (this.isStorageSyncQueued) return;
      this.isStorageSyncQueued = true;
      this.sendWhenConnected(() => {
        this.isStorageSyncQueued = false;
        return this.syncStorage();
      }).catch(this.events.onError);
    }, STORAGE_SYNC_DELAY_MS);
  }

  /** Stores a conversation changed on this device and marks the storage record fields that changed */
  private async putLocalConversation(previous: ConversationRecord, next: ConversationRecord) {
    const account = await this.getAccount();
    await this.putConversation(next);
    await this.markStorageChanges(getStorageChanges(previous, next, account.aci));
    return next;
  }

  private async markStorageChanges(added: StorageChanges) {
    if (!Object.keys(added).length) return;
    const { store } = this.client;
    await store.setItem('storageChanges', mergeStorageChanges(await store.getItem('storageChanges') ?? {}, added));
    this.storageChangeCount++;
    this.scheduleStorageSync();
  }

  /**
   * Merges storage service records: contacts and groups with their archive, mute, block and message request state,
   * and the account record with Note to Self, the order of pinned conversations and settings. Fields in
   * `storageChanges` keep their local values. Profile keys of contacts replace the local ones only in the first sync
   * of this device, or when there is none; else the local key is marked to be written to the contact record.
   */
  private async mergeStorageRecords(records: StorageRecord[], isFirstSync: boolean) {
    const { store } = this.client;
    const account = await this.getAccount();
    const changes = await store.getItem('storageChanges') ?? {};
    const accountChanges = new Set(changes[ACCOUNT_KEY]);
    const blockedE164s = new Set(await store.getItem('blockedE164s'));
    const blockedE164Count = blockedE164s.size;
    // Lists changed here since the last write keep their local state
    const remoteStoryLists: StoryDistributionList[] = [];
    // The same for notification profiles; the account record brings the manual override and the sync setting
    const remoteNotificationProfiles: NotificationProfile[] = [];
    // Groups of notification profiles are allowed by their conversations, which have to be here with their master key
    const groupIdsWithKey = new Set(
      (await this.db.getConversations()).filter(({ masterKey }) => masterKey).map(({ id }) => id),
    );
    let notificationProfileAccount: Parameters<NotificationProfileManager['mergeRemote']>[1];
    // Pins come only from the account record
    let pinIndexById: Map<string, number> | undefined;
    let isProfileKeyChanged = false;
    const profileKeyChanges: StorageChanges = {};

    for (const { record } of records) {
      if (record.case === 'contact') {
        const contact = record.value;
        const aci = getAci(contact.aci, contact.aciBinary);
        // Numbers without an ACI have no conversation, but their block goes into the blocked list we sync
        if (!aci && contact.blocked && contact.e164) blockedE164s.add(contact.e164);
        if (!aci || aci === account.aci) continue;
        if (contact.profileKey.length) {
          // Signal Desktop `mergeContactRecord` in `ts/services/storageRecordOps.preload.ts`
          const localProfileKey = (await store.getRecipient(aci))?.profileKey;
          if (isFirstSync || !localProfileKey) {
            await saveProfileKey(store, aci, contact.profileKey);
          } else if (!buffersEqual(localProfileKey, contact.profileKey)) {
            profileKeyChanges[aci] = ['profileKey'];
          }
        }

        const conversation = await this.ensurePrivateConversation(aci);
        await this.putConversation({
          ...conversation,
          e164: contact.e164 || conversation.e164,
          profileName: contact.givenName || conversation.profileName,
          profileFamilyName: contact.familyName || conversation.profileFamilyName,
          systemName: [contact.systemGivenName, contact.systemFamilyName].filter(Boolean).join(' ') || undefined,
          nickname: [contact.nickname?.given, contact.nickname?.family].filter(Boolean).join(' ') || undefined,
          username: contact.username || undefined,
          ...omitChangedFields({
            isArchived: contact.archived,
            isMarkedUnread: contact.markedUnread,
            isBlocked: contact.blocked,
            isAccepted: contact.whitelisted || conversation.isAccepted,
            mutedUntil: getMutedUntil(contact.mutedUntilTimestamp),
            isStoryHidden: contact.hideStory || undefined,
          }, changes[aci]),
        });
      } else if (record.case === 'groupV2' && record.value.masterKey.length) {
        const group = record.value;
        const conversation = await this.getOrCreateGroupConversation(group.masterKey, 0);
        await this.putConversation({
          ...conversation,
          ...omitChangedFields({
            isArchived: group.archived,
            isMarkedUnread: group.markedUnread,
            isBlocked: group.blocked,
            isAccepted: group.whitelisted || conversation.isAccepted,
            mutedUntil: getMutedUntil(group.mutedUntilTimestamp),
            isStoryHidden: group.hideStory || undefined,
          }, changes[conversation.id]),
        });
      } else if (record.case === 'account') {
        const accountRecord = record.value;
        if (!accountChanges.has('pinnedConversations')) {
          pinIndexById = new Map();
          accountRecord.pinnedConversations.forEach(({ identifier }, index) => {
            if (identifier.case === 'contact') {
              const aci = getAci(identifier.value.serviceId, identifier.value.serviceIdBinary);
              if (aci) pinIndexById!.set(aci, index);
            } else if (identifier.case === 'groupMasterKey') {
              pinIndexById!.set(getGroupId(identifier.value), index);
            }
          });
        }
        const self = await this.ensurePrivateConversation(account.aci);
        // Signal Android `AccountRecordProcessor`: the names and the avatar of the record win unless they are empty
        const hasRemoteName = Boolean(accountRecord.givenName || accountRecord.familyName);
        await this.putConversation({
          ...self,
          isArchived: accountChanges.has('noteToSelfArchived') ? self.isArchived : accountRecord.noteToSelfArchived,
          isMarkedUnread: accountChanges.has('noteToSelfMarkedUnread')
            ? self.isMarkedUnread
            : accountRecord.noteToSelfMarkedUnread,
          profileName: hasRemoteName && !accountChanges.has('givenName')
            ? accountRecord.givenName || undefined
            : self.profileName,
          profileFamilyName: hasRemoteName && !accountChanges.has('familyName')
            ? accountRecord.familyName || undefined
            : self.profileFamilyName,
          avatarPath: accountRecord.avatarUrlPath && !accountChanges.has('avatarUrlPath')
            ? accountRecord.avatarUrlPath
            : self.avatarPath,
        });
        const { usernameLink } = accountRecord;
        const updatedAccount = await this.client.updateAccount({
          ...omitAccountChanges({
            isReadReceiptsEnabled: accountRecord.readReceipts,
            isTypingIndicatorsEnabled: accountRecord.typingIndicators,
            isLinkPreviewsEnabled: accountRecord.linkPreviews,
            isSealedSenderIndicatorsEnabled: accountRecord.sealedSenderIndicators,
            universalExpireTimer: accountRecord.universalExpireTimer || undefined,
            // Signal Desktop `mergeAccountRecord`: an unknown sharing mode means nobody
            isPhoneNumberShared: accountRecord.phoneNumberSharingMode
              === AccountRecord_PhoneNumberSharingMode.EVERYBODY,
            isPhoneNumberUnlisted: accountRecord.unlistedPhoneNumber,
            usernameLink: usernameLink?.entropy.length && usernameLink.serverId.length
              ? { entropy: usernameLink.entropy, serverId: uuidToString(usernameLink.serverId) }
              : undefined,
            isStoriesDisabled: accountRecord.storiesDisabled || undefined,
            isStoryViewReceiptsEnabled: getOptionalBool(accountRecord.storyViewReceiptsEnabled),
          }, accountChanges),
        });
        if (Boolean(account.isPhoneNumberUnlisted) !== Boolean(updatedAccount.isPhoneNumberUnlisted)) {
          this.events.onOwnIdentifierChange?.('phoneNumberDiscoverability');
        }
        if (accountRecord.storiesDisabled && !accountChanges.has('storiesDisabled')) await this.removeAllStories();
        notificationProfileAccount = {
          override: parseNotificationProfileOverride(accountRecord),
          isOverrideChanged: accountChanges.has('notificationProfileManualOverride'),
          isSyncDisabled: accountRecord.notificationProfileSyncDisabled,
        };
        const username = accountRecord.username || undefined;
        if (!accountChanges.has('username') && self.username !== username) {
          await this.putConversation({ ...await this.ensurePrivateConversation(account.aci), username });
          this.events.onOwnIdentifierChange?.('username');
        }
        // Signal Desktop `mergeAccountRecord`: the primary device rotates the profile key, linked devices follow it
        const { profileKey } = accountRecord;
        if (
          account.deviceId !== SIGNAL_PRIMARY_DEVICE_ID && profileKey.length
          && !(account.profileKey && buffersEqual(account.profileKey, profileKey))
        ) {
          await this.client.updateAccount({ profileKey });
          isProfileKeyChanged = true;
        }
      } else if (record.case === 'storyDistributionList') {
        const list = parseStoryDistributionList(record.value);
        if (list && !changes[getStoryListKey(list.id)]) remoteStoryLists.push(list);
      } else if (record.case === 'notificationProfile') {
        const profile = parseNotificationProfile(record.value, getGroupId, (id) => groupIdsWithKey.has(id));
        if (profile && !changes[getNotificationProfileKey(profile.id)]) remoteNotificationProfiles.push(profile);
      } else if (record.case === 'installedStickerPack' && record.value.packId.length) {
        // Signal Desktop `mergeInstalledStickerPackRecord` in `ts/services/storageRecordOps.preload.ts`
        const { packId, packKey, position, deletedAtTimestamp } = record.value;
        const id = bufferToHex(packId);
        if (changes[getStickerPackStorageKey(id)]) continue;
        await this.applyStickerPackState(
          id,
          packKey.length ? bufferToHex(packKey) : undefined,
          // An unset position reads as 0 and leaves the local one (Signal Desktop keeps it when the field is absent)
          deletedAtTimestamp
            ? { uninstalledAt: Number(deletedAtTimestamp) }
            : { isInstalled: true, position: position || undefined },
        );
      }
    }

    if (remoteStoryLists.length) {
      const remoteIds = new Set(remoteStoryLists.map(({ id }) => id));
      const local = await store.getItem('storyDistributionLists') ?? [];
      await store.setItem('storyDistributionLists', [
        ...local.filter(({ id }) => !remoteIds.has(id)), ...remoteStoryLists,
      ]);
    }

    if (remoteNotificationProfiles.length || notificationProfileAccount) {
      await this.notificationProfiles.mergeRemote(remoteNotificationProfiles, notificationProfileAccount);
    }

    if (blockedE164s.size !== blockedE164Count) await store.setItem('blockedE164s', [...blockedE164s]);
    await this.markStorageChanges(profileKeyChanges);
    // The profile under the new key has our current name and avatar; the queue runs it after this merge
    if (isProfileKeyChanged) this.queueProfileRefresh(account.aci);
    if (getIsContactDiscoveryEnabled(account)) {
      const numberOnlyContacts = getNumberOnlyContacts(records);
      if (numberOnlyContacts.length) this.resolveContactNumbers(numberOnlyContacts).catch(this.events.onError);
    }

    if (!pinIndexById) return;
    for (const conversation of await this.db.getConversations()) {
      const pinIndex = pinIndexById.get(conversation.id);
      if (conversation.pinIndex !== pinIndex) await this.putConversation({ ...conversation, pinIndex });
    }
  }

  /**
   * Looks up the numbers of all stored storage service contacts without an ACI, once contact discovery is turned on.
   * Only a primary device does it: a linked device gets contacts with ACIs from the primary device.
   */
  async discoverStorageContacts() {
    const { store } = this.client;
    if (!getIsContactDiscoveryEnabled(await this.getAccount())) return;
    const manifest = await store.getItem('storageManifest');
    if (!manifest) return;
    const ids = getManifestIds(fromBinary(ManifestRecordSchema, manifest));
    const records = (await store.getStorageRecords(ids))
      .filter(Boolean)
      .map((record) => fromBinary(StorageRecordSchema, record));
    const contacts = getNumberOnlyContacts(records);
    if (contacts.length) await this.resolveContactNumbers(contacts);
  }

  /**
   * Creates conversations for the storage service contacts whose numbers turn out to have Signal accounts. Their
   * records stay as they are: the conversations change only locally.
   */
  private async resolveContactNumbers(contacts: ContactRecord[]) {
    const { store, connection } = this.client.getSenderContext();
    const records = await refreshE164s(
      connection, store, contacts.map(({ e164 }) => e164), await this.getAcisAndAccessKeys(),
    );
    await this.runSerial(async () => {
      for (const contact of contacts) {
        const aci = records.get(contact.e164)?.aci;
        if (!aci) continue;
        if (contact.profileKey.length) await saveProfileKey(this.client.store, aci, contact.profileKey);
        const conversation = await this.ensurePrivateConversation(aci);
        await this.putConversation({
          ...conversation,
          e164: contact.e164,
          systemName: [contact.systemGivenName, contact.systemFamilyName].filter(Boolean).join(' ') || undefined,
        });
      }
    });
    this.flush();
  }

  /** The ACIs and access keys of the other users whose numbers we know, which let CDSI return their ACIs */
  private async getAcisAndAccessKeys() {
    const { store, account } = this.client.getSenderContext();
    const acisAndAccessKeys = [];
    for (const { id, type, e164 } of await this.db.getConversations()) {
      if (type !== 'private' || !e164 || id === account.aci) continue;
      const profileKey = (await store.getRecipient(id))?.profileKey;
      if (profileKey) acisAndAccessKeys.push({ aci: id, accessKey: wasm.ProfileKey_DeriveAccessKey(profileKey) });
    }
    return acisAndAccessKeys;
  }

  /**
   * Stores whether a sticker pack is installed and returns whether that changed. A pack installed without a position
   * goes after the others; a removal of a pack this device never had needs no record.
   */
  private async applyStickerPackState(id: string, key: string | undefined, state: StickerPackState) {
    const { store } = this.client;
    const packs = await store.getItem('stickerPacks') ?? {};
    const current = packs[id];
    const packKey = key ?? current?.key;
    if (!packKey || !getIsStickerPackValid(id, packKey)) return false;

    const wasInstalled = current?.installedAt !== undefined;
    if ('isInstalled' in state) {
      if (wasInstalled && (state.position === undefined || state.position === current.position)) return false;
      packs[id] = {
        id,
        key: packKey,
        installedAt: current?.installedAt ?? Date.now(),
        position: state.position ?? current?.position ?? getNextStickerPackPosition(Object.values(packs)),
      };
    } else {
      if (!wasInstalled) return false;
      packs[id] = { id, key: packKey, uninstalledAt: state.uninstalledAt };
    }
    await store.setItem('stickerPacks', packs);
    this.events.onStickerPacksChange?.([id]);
    return true;
  }

  /** The account of this device; it is stored at linking, so local records work without a connection */
  private async getAccount() {
    const account = await this.client.store.getItem('account');
    if (!account) throw new Error('This browser is not linked to a Signal account');
    return account;
  }

  /** Our ACI and a timestamp identify each message we send, so every send takes a new timestamp */
  private allocateTimestamp() {
    this.lastTimestamp = Math.max(Date.now(), this.lastTimestamp + 1);
    return this.lastTimestamp;
  }

  /**
   * Sends the content of a stored outgoing message and records each recipient's status and, for a failure, its
   * reason (Signal Desktop `send` in `ts/messages/send.preload.ts`)
   */
  private async sendStoredMessage(
    conversation: ConversationRecord,
    message: MessageRecord,
    content: OutgoingMessage,
    options: { timestamp: number; expirationStartTimestamp?: number },
    recipients = Object.keys(message.recipientStatus ?? {}),
  ) {
    let sent: MessageRecord;
    try {
      const results = await this.sendContentTo(conversation, recipients, content, options);
      sent = await this.runSerial(() => this.storeSendResults(conversation, message, recipients, results));
    } finally {
      this.markSendEnded(message.id);
    }
    if (sent.sendRetry) await this.scheduleSendRetry().catch(this.events.onError);
    return sent;
  }

  private async storeSendResults(
    conversation: ConversationRecord, message: MessageRecord, recipients: string[], results: RecipientResult[],
  ) {
    const current = await this.db.getMessage(message.id);
    if (!current) return message;

    const recipientStatus = { ...current.recipientStatus };
    const recipientErrors = { ...current.recipientErrors };
    for (const serviceId of recipients) {
      const error = getResultError(results, serviceId);
      if (error instanceof NotGroupMemberError) {
        // Not a recipient any more: a member who joins again is not offered a resend of the message
        delete recipientStatus[serviceId];
        delete recipientErrors[serviceId];
      } else if (error) {
        recipientStatus[serviceId] = 'failed';
        recipientErrors[serviceId] = getSendErrorKind(error);
      } else {
        recipientStatus[serviceId] = maxStatus(recipientStatus[serviceId], 'sent');
        delete recipientErrors[serviceId];
      }
    }
    this.logFailedSends(message.id, conversation, recipients, results);
    const nextErrors = Object.keys(recipientErrors).length ? recipientErrors : undefined;
    return this.putMessage({
      ...current,
      recipientStatus,
      recipientErrors: nextErrors,
      sendRetry: getNextSendRetry(current.sendRetry, { recipientStatus, recipientErrors: nextErrors }, conversation),
    });
  }

  /** Logs how many recipients a send failed for and why, without account ids, phone numbers or content */
  private logFailedSends(
    messageId: number, conversation: ConversationRecord, recipients: string[], results: RecipientResult[],
  ) {
    const reasons = new Map<string, { kind: SendErrorKind; count: number }>();
    for (const { error } of results) {
      // Members of a group whose accounts are gone, or who left it, are no failure
      if (!error || (conversation.type === 'group'
        && (error instanceof UnregisteredUserError || error instanceof NotGroupMemberError))) continue;
      const reason = describeSendError(error);
      const entry = reasons.get(reason) ?? { kind: getSendErrorKind(error), count: 0 };
      entry.count++;
      reasons.set(reason, entry);
    }
    if (!reasons.size) return;

    const failedCount = [...reasons.values()].reduce((sum, { count }) => sum + count, 0);
    const details = [...reasons].map(([reason, { kind, count }]) => `${count} x ${kind} (${reason})`).join('; ');
    this.events.onError(new Error(
      `Message ${messageId} of a ${conversation.type} conversation failed for ${failedCount} of ${recipients.length} `
      + `recipients: ${details}`,
    ));
  }

  /**
   * Sends a data message that has no record of its own, such as a reaction or a delete, to the members of
   * a conversation; returns whether it reached any of them
   */
  private async sendToConversation(
    conversation: ConversationRecord,
    init: MessageInitShape<typeof DataMessageSchema>,
    timestamp: number,
    shouldIncludeTimer = true,
    isStory?: boolean,
  ) {
    const account = await this.getAccount();
    const recipients = getRecipientAcis(conversation, account.aci);
    const dataMessage = createOutgoingDataMessage(account, conversation, init, timestamp, shouldIncludeTimer);
    const results = await this.sendContentTo(conversation, recipients, { case: 'dataMessage', value: dataMessage }, {
      timestamp, isStory,
    });
    return !recipients.length || recipients.some((serviceId) => !getResultError(results, serviceId));
  }

  /**
   * Sends to `recipients`; without a connection, or when the send fails as a whole, every recipient fails. A group
   * send leaves out members whose accounts a send found gone in the last `UNREGISTERED_SKIP_MS`, and they fail as
   * unregistered without a request (Signal Desktop `getSendRecipientLists`).
   */
  private async sendContentTo(
    conversation: ConversationRecord,
    recipients: string[],
    content: OutgoingMessage,
    options: {
      timestamp: number;
      expirationStartTimestamp?: number;
      isStory?: boolean;
      isUrgent?: boolean;
      // A group update also goes to the members it removed
      shouldIncludeFormerMembers?: boolean;
    },
  ): Promise<RecipientResult[]> {
    const { store } = this.client;
    const discoveredTimes = await Promise.all(recipients.map(async (serviceId) => (
      (await store.getRecipient(serviceId))?.discoveredUnregisteredAt
    )));
    const unregisteredAt = new Map<string, number>();
    recipients.forEach((serviceId, index) => {
      if (discoveredTimes[index]) unregisteredAt.set(serviceId, discoveredTimes[index]);
    });
    const isSkipped = (serviceId: string) => (
      conversation.type === 'group' && Date.now() - (unregisteredAt.get(serviceId) ?? 0) < UNREGISTERED_SKIP_MS
    );
    const skipped = recipients.filter(isSkipped);
    const sendable = recipients.filter((serviceId) => !isSkipped(serviceId));

    let results: RecipientResult[];
    try {
      const context = this.client.getSenderContext();
      const outcome = await sendMessage(context, sendable, content, {
        ...options,
        group: this.getGroupTarget(conversation, options.shouldIncludeFormerMembers),
      });
      results = outcome.results;
      if (outcome.followUpError) {
        this.events.onError(new Error(
          `The transcript of a ${conversation.type} message failed: ${describeSendError(outcome.followUpError)}`,
        ));
        // The transcript is all that a message to ourselves sends; for others, the recipients got it either way
        if (sendable.includes(context.account.aci)) {
          results.push({ serviceId: context.account.aci, error: outcome.followUpError });
        }
      }
    } catch (err) {
      this.events.onError(new Error(`Sending a ${conversation.type} message failed: ${describeSendError(err)}`));
      results = sendable.map((serviceId) => ({ serviceId, error: err as Error }));
    }

    await this.updateRegistrations(results, unregisteredAt);
    return [...results, ...skipped.map((serviceId) => ({ serviceId, error: new UnregisteredUserError(serviceId) }))];
  }

  /**
   * Remembers the recipients whose accounts are gone, and forgets that for those the send reached after all
   * (Signal Desktop `setUnregistered` and `setRegistered`)
   */
  private async updateRegistrations(results: RecipientResult[], unregisteredAt: Map<string, number>) {
    const { store } = this.client;
    for (const { serviceId, error } of results) {
      if (error instanceof UnregisteredUserError) {
        await store.updateRecipient(serviceId, { discoveredUnregisteredAt: Date.now() });
      } else if (!error && unregisteredAt.has(serviceId)) {
        await store.updateRecipient(serviceId, { discoveredUnregisteredAt: undefined });
      }
    }
  }

  /** Group sends renew the send endorsements of the group through its state */
  private getGroupTarget(
    conversation: ConversationRecord, shouldIncludeFormerMembers?: boolean,
  ): GroupTarget | undefined {
    if (conversation.type !== 'group' || !conversation.masterKey) return undefined;
    const { id, masterKey } = conversation;
    return {
      id: bufferFromBase64(id),
      secretParams: wasm.GroupSecretParams_DeriveFromMasterKey(masterKey),
      refresh: async () => {
        await this.refreshGroup(id, masterKey);
      },
      getMemberAcis: shouldIncludeFormerMembers
        ? undefined
        : async () => (await this.db.getConversation(id))?.memberAcis,
    };
  }

  private async handleContent(decrypted: DecryptedEnvelope) {
    const { senderServiceId, senderDeviceId, envelope, isSealedSender } = decrypted;
    const body = decrypted.content.content;
    const selfAci = this.client.getSenderContext().account.aci;
    const source: MessageSource = {
      authorAci: senderServiceId,
      authorDeviceId: senderDeviceId,
      sentAt: Number(envelope.clientTimestamp),
      serverTimestamp: Number(envelope.serverTimestamp) || undefined,
      isOutgoing: false,
      isSealedSender,
      serverGuid: envelope.serverGuid
        || (envelope.serverGuidBinary.length ? uuidToString(envelope.serverGuidBinary) : undefined),
    };

    // A data message that another device of ours sends in an envelope instead of a transcript is our own message,
    // outgoing and read; outside a group it is a note to ourselves
    const isFromSelf = senderServiceId === selfAci;
    const ownDevice: Partial<MessageSource> = isFromSelf ? { isOutgoing: true, destinationAci: selfAci } : {};

    if (!isFromSelf) {
      const sender = await this.db.getConversation(senderServiceId);
      // Signal Desktop `ts/textsecure/MessageReceiver.preload.ts` drops everything from blocked senders
      if (sender?.isBlocked) return;
      // Signal Desktop `handleDataMessage` in `ts/messages/handleDataMessage.preload.ts` (`setRegistered`): someone
      // who writes to us has an account, so group sends include them again
      const { store } = this.client;
      if ((await store.getRecipient(senderServiceId))?.discoveredUnregisteredAt) {
        await store.updateRecipient(senderServiceId, { discoveredUnregisteredAt: undefined });
      }
      // Signal Desktop `onEnvelopeUnsealed` in `ts/background.preload.ts`: the latest token goes with spam reports
      const token = envelope.reportSpamToken;
      if (token.length && !(sender?.reportingToken && buffersEqual(sender.reportingToken, token))) {
        const conversation = sender ?? await this.ensurePrivateConversation(senderServiceId);
        await this.putConversation({ ...conversation, reportingToken: token });
      }
    }

    switch (body.case) {
      case 'dataMessage': {
        const sentAt = Number(body.value.timestamp) || source.sentAt;
        // Dropped messages are not acknowledged with a receipt
        if (await this.handleDataMessage({ ...source, sentAt, ...ownDevice }, body.value)) {
          if (!isFromSelf) this.queueDeliveryReceipt(senderServiceId, sentAt);
        }
        break;
      }
      case 'editMessage':
        await this.handleEditMessage({ ...source, ...ownDevice }, body.value);
        if (!isFromSelf) this.queueDeliveryReceipt(senderServiceId, source.sentAt);
        break;
      case 'syncMessage':
        if (senderServiceId === selfAci) {
          await this.handleSyncMessage(source, body.value);
        }
        break;
      case 'receiptMessage':
        await this.handleReceipt(senderServiceId, body.value);
        break;
      case 'typingMessage':
        await this.handleTyping(senderServiceId, body.value);
        break;
      case 'storyMessage':
        await this.handleStoryMessage(source, body.value);
        break;
      default:
        // Calls are not supported yet
        break;
    }
  }

  /** Returns `false` for a message of a group that is dropped, see `getIsGroupMessageDropped` */
  private async handleDataMessage(source: MessageSource, message: DataMessage) {
    const conversation = await this.getConversationForMessage(source, message);
    if (!conversation) return false;
    await this.applyDataMessage(source, message, conversation);
    return true;
  }

  private async applyDataMessage(source: MessageSource, message: DataMessage, conversation: ConversationRecord) {
    if (!source.isOutgoing && conversation.isBlocked) return;

    if (message.groupCallUpdate) {
      await this.applyGroupCallUpdate(conversation, source, message.groupCallUpdate.eraId);
      return;
    }
    if (message.storyContext) {
      await this.applyStoryReply(conversation, source, message);
      return;
    }
    if (message.reaction) {
      await this.applyReaction(source, message.reaction);
      return;
    }
    if (message.delete) {
      await this.applyDelete(source.authorAci, Number(message.delete.targetSentTimestamp));
      return;
    }
    if (message.adminDelete) {
      const isAdmin = conversation.adminAcis?.includes(source.authorAci);
      if (isAdmin) {
        await this.applyDelete(
          uuidToString(message.adminDelete.targetAuthorAciBinary),
          Number(message.adminDelete.targetSentTimestamp),
          source.authorAci,
        );
      }
      return;
    }
    if (message.pollVote) {
      await this.applyPollVote(source.authorAci, message);
      return;
    }
    if (message.pollTerminate) {
      const target = await this.db.findMessage(source.authorAci, Number(message.pollTerminate.targetSentTimestamp));
      if (target) await this.putMessage({ ...target, isPollEnded: true });
      return;
    }
    if (message.pinMessage || message.unpinMessage) {
      await this.applyPin(conversation, source.authorAci, message);
      return;
    }

    if (await this.db.findMessage(source.authorAci, source.sentAt)) return;

    const updated = await this.updateExpireTimer(conversation, source, message);
    if ((message.flags & DataMessage_Flags.EXPIRATION_TIMER_UPDATE)
      || (message.flags & DataMessage_Flags.PROFILE_KEY_UPDATE)
      || !hasMessageContent(message)) {
      return;
    }
    await this.addDataMessage(updated, source, message);
  }

  private async addDataMessage(conversation: ConversationRecord, source: MessageSource, message: DataMessage) {
    const expireTimer = message.expireTimer || undefined;
    const expirationStart = source.isOutgoing ? source.expirationStartTimestamp ?? source.sentAt : undefined;
    const { message: added } = await this.addMessage(conversation, {
      conversationId: conversation.id,
      kind: 'message',
      authorAci: source.authorAci,
      authorDeviceId: source.authorDeviceId,
      sentAt: source.sentAt,
      receivedAt: Date.now(),
      serverTimestamp: source.serverTimestamp,
      isOutgoing: source.isOutgoing,
      dataMessage: toBinary(DataMessageSchema, message),
      body: message.body || undefined,
      expireTimer,
      expiresAt: expireTimer && expirationStart !== undefined ? expirationStart + expireTimer * 1000 : undefined,
      readAt: source.isOutgoing ? source.sentAt : undefined,
      recipientStatus: source.sentTo
        ? Object.fromEntries(source.sentTo.map(({ serviceId }) => [serviceId, 'sent' as const]))
        : undefined,
      isSealedSender: source.isSealedSender,
      serverGuid: source.serverGuid,
    });
    if (source.isOutgoing && added.recipientStatus) await this.applyEarlyReceipts(source.sentAt);
  }

  private async handleEditMessage(source: MessageSource, edit: EditMessage) {
    const target = await this.db.findMessage(source.authorAci, Number(edit.targetSentTimestamp));
    if (!target?.dataMessage || !edit.dataMessage || target.deletedAt) return;
    if (!source.isOutgoing && (await this.db.getConversation(target.conversationId))?.isBlocked) return;

    await this.putMessage({
      ...target,
      revisions: [...target.revisions ?? [], {
        dataMessage: target.dataMessage, editedAt: target.editedAt ?? target.sentAt,
      }],
      dataMessage: toBinary(DataMessageSchema, edit.dataMessage),
      body: edit.dataMessage.body || undefined,
      editedAt: Number(edit.dataMessage.timestamp) || source.sentAt,
    });
  }

  /**
   * Signal Desktop `handleGroupCallUpdateMessage` in `ts/messages/handleDataMessage.preload.ts`: a call that someone
   * started adds to the call history, unless the group is a message request or only admins may write and the sender
   * is none
   */
  private async applyGroupCallUpdate(conversation: ConversationRecord, source: MessageSource, eraId: string) {
    const selfAci = this.client.getSenderContext().account.aci;
    const canCreate = !source.isOutgoing && getIsConversationAccepted(conversation, selfAci)
      && (!conversation.isAnnouncementsOnly || Boolean(conversation.adminAcis?.includes(source.authorAci)));
    await applyGroupCallUpdate(this.callHistory, conversation, eraId, source.sentAt, canCreate);
  }

  private async handleSyncMessage(source: MessageSource, sync: SyncMessage) {
    const ownSource = { ...source, isOutgoing: true };

    for (const read of sync.read) {
      await this.applyReadSync(read.senderAci || uuidToString(read.senderAciBinary), Number(read.timestamp), source);
    }
    for (const viewed of sync.viewed) {
      const senderAci = viewed.senderAci || uuidToString(viewed.senderAciBinary);
      const viewedAt = source.serverTimestamp ?? Date.now();
      const target = await this.db.findMessage(senderAci, Number(viewed.timestamp));
      if (target) {
        await this.putMessage({ ...target, viewedAt });
        continue;
      }
      const story = await this.db.findStory(senderAci, Number(viewed.timestamp));
      if (story && !story.viewedAt) await this.putStory({ ...story, viewedAt });
    }
    for (const { packId, packKey, type } of sync.stickerPackOperation) {
      await this.applyStickerPackState(
        bufferToHex(packId),
        bufferToHex(packKey),
        type === SyncMessage_StickerPackOperation_Type.REMOVE ? { uninstalledAt: Date.now() } : { isInstalled: true },
      );
    }

    const { content } = sync;
    switch (content.case) {
      case 'sent':
        await this.handleSentTranscript(ownSource, content.value);
        break;
      case 'contacts':
        if (content.value.blob) await this.applyContactSync(await downloadAttachment(content.value.blob));
        break;
      case 'blocked':
        await this.applyBlockedSync(content.value);
        break;
      case 'configuration':
        await this.client.updateAccount({
          isReadReceiptsEnabled: content.value.readReceipts,
          isTypingIndicatorsEnabled: content.value.typingIndicators,
          isLinkPreviewsEnabled: content.value.linkPreviews,
          isSealedSenderIndicatorsEnabled: content.value.unidentifiedDeliveryIndicators,
        });
        break;
      case 'viewOnceOpen': {
        const { senderAci, senderAciBinary, timestamp } = content.value;
        const target = await this.db.findMessage(senderAci || uuidToString(senderAciBinary), Number(timestamp));
        if (target) await this.putMessage({ ...target, isViewOnceOpened: true, dataMessage: undefined });
        break;
      }
      case 'messageRequestResponse':
        await this.applyMessageRequestResponseSync(content.value);
        break;
      case 'deleteForMe':
        await this.applyDeleteForMeSync(content.value);
        break;
      case 'verified':
        await this.applyVerifiedSync(content.value);
        break;
      case 'fetchLatest':
        // Another device wrote our profile or the storage service (Signal Desktop `onFetchLatestSync`); the profile
        // is fetched outside the serial queue, which this handler runs in
        if (content.value.type === SyncMessage_FetchLatest_Type.LOCAL_PROFILE) {
          void this.refreshProfile(source.authorAci).catch(this.events.onError);
        }
        if (content.value.type === SyncMessage_FetchLatest_Type.STORAGE_MANIFEST) this.scheduleStorageSync();
        break;
      case 'usernameChange':
        // Another device changed our username and wrote it to the storage service
        this.scheduleStorageSync();
        break;
      case 'attachmentBackfillResponse':
        await this.applyAttachmentBackfillResponse(content.value);
        break;
      case 'callEvent': {
        const event = getCallEvent(content.value);
        if (event) await applyCallEvent(this.callHistory, event);
        break;
      }
      case 'callLogEvent': {
        const event = getCallLogEvent(content.value);
        if (event) await applyCallLogEvent(this.callHistory, event);
        break;
      }
      case 'request':
        await this.answerSyncRequest(content.value.type);
        break;
      default:
        break;
    }
  }

  private sendConfiguration(account: AccountRecord) {
    return this.sendWhenConnected(async (context) => {
      await sendConfigurationSync(context, {
        readReceipts: account.isReadReceiptsEnabled,
        typingIndicators: account.isTypingIndicatorsEnabled,
        linkPreviews: account.isLinkPreviewsEnabled,
        unidentifiedDeliveryIndicators: account.isSealedSenderIndicatorsEnabled,
      });
    });
  }

  /**
   * A device we linked asks for our message settings and blocked list. Only a primary device answers (Signal
   * Android `SyncMessageProcessor.handleSynchronizeRequestMessage`); contacts and keys reach the new device through
   * the storage service and the provisioning message instead.
   */
  private async answerSyncRequest(type: SyncMessage_Request_Type) {
    const account = await this.getAccount();
    if (account.deviceId !== SIGNAL_PRIMARY_DEVICE_ID) return;

    if (type === SyncMessage_Request_Type.CONFIGURATION) {
      await this.sendConfiguration(account);
    } else if (type === SyncMessage_Request_Type.BLOCKED) {
      await this.sendWhenConnected((context) => this.sendBlockedList(context));
    }
  }

  /**
   * Applies a verification change from another device (Signal Android `IdentityUtil.processVerifiedMessage`, Signal
   * Desktop `processVerifiedMessage` in `ts/SignalProtocolStore.preload.ts`): a verified key is saved, and the
   * verification is cleared only for the key we have. Syncs about ourselves and unverified syncs change nothing.
   */
  private async applyVerifiedSync(verified: Verified) {
    const aci = verified.destinationAci
      || (verified.destinationAciBinary.length ? uuidToString(verified.destinationAciBinary) : undefined);
    const { identityKey, state } = verified;
    if (!aci || !identityKey.length || state === Verified_State.UNVERIFIED) return;
    if (aci === (await this.getAccount()).aci) return;

    const { store } = this.client;
    const wasVerified = await store.runExclusive(async () => {
      const existing = await store.getIdentity(aci);
      const isSameKey = Boolean(existing && buffersEqual(existing.publicKey, identityKey));
      if (state === Verified_State.DEFAULT && !isSameKey) return undefined;
      if (!isSameKey) await saveIdentity(store, aci, identityKey);
      const current = (await store.getIdentity(aci))!;
      if ((current.verified ?? Verified_State.DEFAULT) === state) return undefined;
      await store.setIdentity(aci, { ...current, verified: state });
      return current.verified === Verified_State.VERIFIED;
    });

    const isVerified = state === Verified_State.VERIFIED;
    if (wasVerified === undefined || wasVerified === isVerified) return;
    await this.addIdentityNotices(aci, { kind: 'verifiedChange', isVerified, isFromOtherDevice: true });
  }

  /** Adds an identity notice about `aci` to their private conversation and to the groups we share with them */
  private async addIdentityNotices(
    aci: string, notice: Pick<NewMessageRecord, 'kind' | 'isVerified' | 'isFromOtherDevice'>,
  ) {
    const now = Date.now();
    const groups = (await this.db.getConversations())
      .filter(({ type, memberAcis }) => type === 'group' && memberAcis?.includes(aci));
    for (const conversation of [await this.ensurePrivateConversation(aci), ...groups]) {
      await this.addMessage(conversation, {
        ...notice,
        conversationId: conversation.id,
        authorAci: '',
        actorAci: aci,
        sentAt: now,
        receivedAt: now,
        isOutgoing: false,
        readAt: now,
      });
    }
  }

  private async handleSentTranscript(source: MessageSource, sent: SyncMessage_Sent) {
    if (sent.storyMessage) {
      await this.handleSentStory(source, sent);
      return;
    }
    if (sent.isRecipientUpdate && sent.storyMessageRecipients.length) {
      await this.applyStoryRecipientUpdate(Number(sent.timestamp), sent.storyMessageRecipients);
      return;
    }

    const destinationAci = sent.destinationServiceId
      || (sent.destinationServiceIdBinary.length ? uuidToString(sent.destinationServiceIdBinary) : undefined);
    const transcriptSource: MessageSource = {
      ...source,
      sentAt: Number(sent.timestamp) || source.sentAt,
      destinationAci,
      sentTo: sent.unidentifiedStatus.map((status) => ({
        serviceId: status.destinationServiceId || uuidToString(status.destinationServiceIdBinary),
        isSealedSender: status.unidentified,
      })),
      expirationStartTimestamp: Number(sent.expirationStartTimestamp) || undefined,
    };

    if (sent.message) await this.handleDataMessage(transcriptSource, sent.message);
    if (sent.editMessage) await this.handleEditMessage(transcriptSource, sent.editMessage);
  }

  /**
   * Stores a story from a contact or a group (Signal Desktop `MessageReceiver.#handleStoryMessage`): nothing while
   * stories are off, from blocked senders and groups, from contacts whose message request we have not accepted, from
   * senders a group does not accept messages from, or after its day ran out
   */
  private async handleStoryMessage(source: MessageSource, story: StoryMessage) {
    const account = await this.getAccount();
    const expiresAt = getStoryExpiresAt(source.sentAt);
    if (account.isStoriesDisabled || expiresAt <= Date.now()) return;
    if (await this.db.findStory(source.authorAci, source.sentAt)) return;

    const conversation = story.group?.masterKey.length
      ? await this.db.getConversation(getGroupId(story.group.masterKey))
      : await this.db.getConversation(source.authorAci);
    if (!conversation || conversation.isBlocked) return;
    // Signal Desktop drops stories of contacts we do not share our profile with
    if (conversation.type === 'private' && !conversation.isAccepted) return;
    if (conversation.type === 'group' && await this.getIsGroupMessageDropped(conversation, source)) return;

    await this.addStory({
      conversationId: conversation.id,
      authorAci: source.authorAci,
      authorDeviceId: source.authorDeviceId,
      sentAt: source.sentAt,
      receivedAt: Date.now(),
      serverTimestamp: source.serverTimestamp,
      expiresAt,
      isOutgoing: false,
      storyMessage: toBinary(StoryMessageSchema, story),
    });
  }

  /**
   * Stores a story that our other device sent (Signal Desktop `#handleStoryMessage` with a sent transcript):
   * a group story in its group, a distribution list story in our own conversation with its recipients
   */
  private async handleSentStory(source: MessageSource, sent: SyncMessage_Sent) {
    const story = sent.storyMessage!;
    const account = await this.getAccount();
    const { aci: selfAci } = account;
    const sentAt = Number(sent.timestamp) || source.sentAt;
    const recipients = buildStoryRecipients(sent.storyMessageRecipients, 'sent');
    const existing = await this.db.findStory(selfAci, sentAt);
    if (existing) {
      await this.putStory({ ...existing, recipients: { ...existing.recipients, ...recipients } });
      return;
    }
    // As for stories of others, nothing is kept while stories are off or after the day ran out
    const expiresAt = getStoryExpiresAt(sentAt);
    if (account.isStoriesDisabled || expiresAt <= Date.now()) return;

    const groupId = story.group?.masterKey.length ? getGroupId(story.group.masterKey) : undefined;
    if (groupId && !await this.db.getConversation(groupId)) return;
    await this.addStory({
      conversationId: groupId ?? selfAci,
      authorAci: selfAci,
      authorDeviceId: source.authorDeviceId,
      sentAt,
      receivedAt: Date.now(),
      serverTimestamp: source.serverTimestamp,
      expiresAt,
      isOutgoing: true,
      storyMessage: toBinary(StoryMessageSchema, story),
      viewedAt: sentAt,
      recipients,
    });
    await this.applyEarlyReceipts(sentAt);
  }

  /**
   * Another device changed who has our distribution list story: recipients left without lists lose it, and a story
   * nobody has any more is deleted (Signal Desktop `ts/util/onStoryRecipientUpdate.preload.ts`)
   */
  private async applyStoryRecipientUpdate(sentAt: number, update: SyncMessage_Sent['storyMessageRecipients']) {
    const story = await this.db.findStory((await this.getAccount()).aci, sentAt);
    if (!story || story.conversationId !== story.authorAci) return;

    const next = buildStoryRecipients(update.filter(({ distributionListIds }) => distributionListIds.length), 'sent');
    for (const [aci, recipient] of Object.entries(next)) {
      const current = story.recipients?.[aci];
      if (current) next[aci] = { ...recipient, status: current.status, viewedAt: current.viewedAt };
    }
    if (!Object.keys(next).length) {
      await this.removeStory(story);
      return;
    }
    await this.putStory({ ...story, recipients: next });
  }

  /**
   * A reply or reaction to a story (`storyContext`). Group story replies stay with the story; in private
   * conversations they are messages too, and replies to our stories are also kept with the story for its replies list.
   */
  private async applyStoryReply(conversation: ConversationRecord, source: MessageSource, message: DataMessage) {
    const account = await this.getAccount();
    // Signal Desktop drops story replies while stories are off
    if (account.isStoriesDisabled) return;
    const { storyContext, reaction } = message;
    if (reaction?.remove) return;
    const storyAuthorAci = storyContext!.authorAci || (storyContext!.authorAciBinary.length
      ? uuidToString(storyContext!.authorAciBinary)
      : undefined);
    const story = storyAuthorAci
      ? await this.db.findStory(storyAuthorAci, Number(storyContext!.sentTimestamp))
      : undefined;

    // Our own replies are kept too, so the story shows our reaction
    if (story && getIsStoryReplyAllowed(story, conversation, source)) {
      await this.addStoryReply(story, {
        authorAci: source.authorAci,
        sentAt: source.sentAt,
        body: message.body || undefined,
        emoji: reaction?.emoji || undefined,
      });
    }
    if (conversation.type === 'group' || await this.db.findMessage(source.authorAci, source.sentAt)) return;
    if (!message.body && !reaction?.emoji) return;
    await this.addDataMessage(conversation, source, message);
  }

  /** Viewed receipts of our stories show who saw them */
  private async applyStoryReceipt(senderAci: string, sentAt: number, status: SendStatus) {
    const story = await this.db.findStory((await this.getAccount()).aci, sentAt);
    const recipient = story?.recipients?.[senderAci];
    if (!story || !recipient) return Boolean(story);
    await this.putStory({
      ...story,
      recipients: {
        ...story.recipients,
        [senderAci]: {
          ...recipient,
          status: maxStatus(recipient.status, status),
          viewedAt: status === 'viewed' ? recipient.viewedAt ?? Date.now() : recipient.viewedAt,
        },
      },
    });
    return true;
  }

  /** Sends a story to the members of distribution lists, each once, and tells our other devices */
  private async sendListStory(
    account: AccountRecord, story: OutgoingStory, lists: StoryDistributionList[], conversations: ConversationRecord[],
  ) {
    // Lists that allow replies come first, so people in several lists may reply (Signal Desktop `sendStoryMessage`)
    const ordered = [...lists].sort((a, b) => Number(b.areRepliesAllowed) - Number(a.areRepliesAllowed));
    const recipients: Record<string, StoryRecipient> = {};
    const acisByList = new Map<string, string[]>();
    for (const list of ordered) {
      const acis = getStoryListRecipientAcis(list, conversations, account.aci);
      acisByList.set(list.id, acis.filter((aci) => !recipients[aci]));
      for (const aci of acis) {
        const recipient = recipients[aci] ??= {
          status: 'pending', isAllowedToReply: list.areRepliesAllowed, distributionListIds: [],
        };
        recipient.distributionListIds.push(list.id);
      }
    }
    if (!Object.keys(recipients).length) return undefined;

    const sentAt = this.allocateTimestamp();
    // The sync carries the story as it reaches people who may reply (Signal Desktop `sendStory`)
    const storyMessage = createOutgoingStoryMessage(account, story, true);
    const stored = await this.runSerial(async () => {
      // Our own conversation holds the stories of our lists
      await this.ensurePrivateConversation(account.aci);
      return this.addStory({
        conversationId: account.aci,
        authorAci: account.aci,
        authorDeviceId: account.deviceId,
        sentAt,
        receivedAt: sentAt,
        expiresAt: getStoryExpiresAt(sentAt),
        isOutgoing: true,
        storyMessage: toBinary(StoryMessageSchema, storyMessage),
        viewedAt: sentAt,
        recipients,
      });
    });

    const results: RecipientResult[] = [];
    for (const list of ordered) {
      const acis = acisByList.get(list.id)!;
      if (!acis.length) continue;
      results.push(...await this.sendStoryTo(acis, createOutgoingStoryMessage(account, story, list.areRepliesAllowed), {
        timestamp: sentAt, target: { type: 'storyList', listId: list.id },
      }));
    }
    return this.finishStorySend(stored, results);
  }

  /** Sends a story to a group: the members may reply in the group */
  private async sendGroupStory(account: AccountRecord, story: OutgoingStory, group: ConversationRecord) {
    const sentAt = this.allocateTimestamp();
    const storyMessage = createOutgoingStoryMessage(account, story, true, group);
    const memberAcis = getRecipientAcis(group, account.aci);
    const stored = await this.runSerial(() => this.addStory({
      conversationId: group.id,
      authorAci: account.aci,
      authorDeviceId: account.deviceId,
      sentAt,
      receivedAt: sentAt,
      expiresAt: getStoryExpiresAt(sentAt),
      isOutgoing: true,
      storyMessage: toBinary(StoryMessageSchema, storyMessage),
      viewedAt: sentAt,
      recipients: Object.fromEntries(memberAcis.map((aci) => [aci, {
        status: 'pending' as const, isAllowedToReply: true, distributionListIds: [],
      }])),
    }));
    const results = await this.sendStoryTo(memberAcis, storyMessage, {
      timestamp: sentAt, target: { type: 'group', group: this.getGroupTarget(group)! },
    });
    return this.finishStorySend(stored, results);
  }

  /** Without a connection, or when the send fails as a whole, every recipient fails */
  private async sendStoryTo(
    recipients: string[], storyMessage: StoryMessage, options: Parameters<typeof sendStory>[3],
  ): Promise<RecipientResult[]> {
    try {
      return await sendStory(this.client.getSenderContext(), recipients, storyMessage, options);
    } catch (err) {
      this.events.onError(err as Error);
      return recipients.map((serviceId) => ({ serviceId, error: err as Error }));
    }
  }

  /** Records each recipient's status and syncs the story with the recipients that got it */
  private async finishStorySend(stored: StoryRecord, results: RecipientResult[]) {
    const updated = await this.runSerial(async () => {
      const current = await this.db.getStory(stored.id);
      if (!current) return stored;
      const recipients = { ...current.recipients };
      for (const [aci, recipient] of Object.entries(recipients)) {
        recipients[aci] = {
          ...recipient, status: getResultError(results, aci) ? 'failed' : maxStatus(recipient.status, 'sent'),
        };
      }
      return this.putStory({ ...current, recipients });
    });

    const storyMessageRecipients: StoryMessageRecipient[] = Object.entries(updated.recipients ?? {})
      .filter(([, { status }]) => status !== 'failed')
      .map(([aci, { distributionListIds, isAllowedToReply }]) => ({
        destinationServiceId: aci, distributionListIds, isAllowedToReply,
      }));
    if (storyMessageRecipients.length) {
      await this.sendWhenConnected((context) => sendStorySync(context, {
        timestamp: updated.sentAt,
        storyMessage: fromBinary(StoryMessageSchema, updated.storyMessage),
        storyMessageRecipients,
      }).then(() => undefined)).catch(this.events.onError);
    }
    return updated;
  }

  /** Keeps one reply per author and timestamp */
  private async addStoryReply(story: StoryRecord, reply: StoryReply) {
    const replies = story.replies ?? [];
    if (replies.some(({ authorAci, sentAt }) => authorAci === reply.authorAci && sentAt === reply.sentAt)) return;
    await this.putStory({ ...story, replies: [...replies, reply] });
  }

  private async addStory(record: NewStoryRecord) {
    const story = await this.db.addStory(record);
    this.changes.stories.push(story);
    this.scheduleExpiration();
    return story;
  }

  private async putStory(record: StoryRecord) {
    await this.db.putStory(record);
    this.changes.stories.push(record);
    return record;
  }

  private async removeStory(story: StoryRecord) {
    await this.db.deleteStory(story.id);
    this.changes.deletedStories.push(story);
    // The photo or video of a story is not kept after the story, unless another story has the same attachment
    const { attachment } = fromBinary(StoryMessageSchema, story.storyMessage);
    if (attachment.case !== 'fileAttachment') return;
    const key = getAttachmentCacheKey(attachment.value);
    const isShared = (await this.db.getStories()).some((other) => {
      const { attachment: otherAttachment } = fromBinary(StoryMessageSchema, other.storyMessage);
      return otherAttachment.case === 'fileAttachment' && getAttachmentCacheKey(otherAttachment.value) === key;
    });
    if (!isShared) await removeAttachmentBlob(attachment.value);
  }

  private async removeAllStories() {
    for (const story of await this.db.getStories()) await this.removeStory(story);
  }

  private async handleReceipt(senderAci: string, receipt: ReceiptMessage) {
    const status = STATUS_BY_RECEIPT_TYPE[receipt.type];
    for (const timestamp of receipt.timestamp) {
      const sentAt = Number(timestamp);
      if (!await this.applyReceipt(senderAci, sentAt, status)) await this.addEarlyReceipt(senderAci, sentAt, status);
    }
  }

  /** Returns whether a message or story of ours at `sentAt` exists; receipts for it from non-recipients change nothing */
  private async applyReceipt(senderAci: string, sentAt: number, status: SendStatus) {
    const { account } = this.client.getSenderContext();
    const message = await this.db.findMessage(account.aci, sentAt);
    if (!message) return this.applyStoryReceipt(senderAci, sentAt, status);

    if (message.recipientStatus && senderAci in message.recipientStatus) {
      await this.putMessage({
        ...message,
        recipientStatus: {
          ...message.recipientStatus,
          [senderAci]: maxStatus(message.recipientStatus[senderAci], status),
        },
      });
    }
    return true;
  }

  /**
   * Keeps a receipt for a message or story that is not stored yet, as can happen for one that another device of ours
   * sent, whose copy reaches us after the recipient's receipt (Signal Desktop `ts/messageModifiers/MessageReceipts.preload.ts`
   * keeps such receipts for `forMessage`). The store is small and keeps receipts for a day.
   */
  private async addEarlyReceipt(senderAci: string, sentAt: number, status: EarlyReceiptRecord['status']) {
    const { store } = this.client;
    // A receipt for something older than all our messages names a message we no longer have
    const oldestSentAt = await this.db.getOldestSentAt(this.client.getSenderContext().account.aci);
    if (oldestSentAt !== undefined && sentAt < oldestSentAt) return;
    const now = Date.now();
    const receipts = (await store.getItem('earlyReceipts') ?? []).filter(({ receivedAt }) => (
      now - receivedAt < EARLY_RECEIPT_MAX_AGE_MS
    ));
    receipts.push({ senderAci, sentAt, status, receivedAt: now });
    await store.setItem('earlyReceipts', receipts.slice(-MAX_EARLY_RECEIPTS));
  }

  /** Applies the early receipts for the message or story of ours that was just stored at `sentAt` */
  private async applyEarlyReceipts(sentAt: number) {
    const { store } = this.client;
    const receipts = await store.getItem('earlyReceipts');
    if (!receipts?.some((receipt) => receipt.sentAt === sentAt)) return;

    const now = Date.now();
    await store.setItem('earlyReceipts', receipts.filter((receipt) => receipt.sentAt !== sentAt));
    for (const receipt of receipts) {
      if (receipt.sentAt !== sentAt || now - receipt.receivedAt >= EARLY_RECEIPT_MAX_AGE_MS) continue;
      await this.applyReceipt(receipt.senderAci, sentAt, receipt.status);
    }
  }

  /** Turning typing indicators off also hides those of others */
  private async handleTyping(senderAci: string, typing: TypingMessage) {
    if (this.client.getSenderContext().account.isTypingIndicatorsEnabled === false) return;
    const conversationId = typing.groupId.length ? bufferToBase64(typing.groupId) : senderAci;
    if ((await this.db.getConversation(conversationId))?.isBlocked) return;
    this.events.onTyping({
      conversationId,
      senderAci,
      isTyping: typing.action === TypingMessage_Action.STARTED,
    });
  }

  private async getConversationForMessage(source: MessageSource, message: DataMessage) {
    if (message.groupV2?.masterKey.length) return this.getGroupConversationForMessage(source, message.groupV2);
    const aci = source.isOutgoing ? source.destinationAci : source.authorAci;
    if (!aci) return undefined;
    const conversation = await this.ensurePrivateConversation(aci);
    // Writing first accepts the message request
    return source.isOutgoing && !conversation.isAccepted
      ? this.putConversation({ ...conversation, isAccepted: true })
      : conversation;
  }

  /** Returns the private conversation with `aci`, creating it (and fetching the profile) when absent */
  getOrCreatePrivateConversation(aci: string) {
    return this.runSerial(() => this.ensurePrivateConversation(aci));
  }

  /**
   * Finds the Signal user of a phone number in the contact discovery enclave and returns their private conversation,
   * which gets the number. Signal Desktop looks up a number that the user typed in the same way
   * (`lookupConversationWithoutServiceId`). Resolves with `undefined` for numbers without a Signal account.
   */
  async lookUpPhoneNumber(e164: string) {
    return (await this.resolvePhoneNumber(e164))?.conversation;
  }

  /** Keeps the number behind an invitation by PNI, which the group state does not have */
  saveInvitedNumber(pniServiceId: string, e164: string) {
    return this.runSerial(async () => {
      await this.client.store.setItem('invitedNumbers', { ...await this.getInvitedNumbers(), [pniServiceId]: e164 });
    });
  }

  /** Forgets the numbers of invitations that no group has any more, because they were accepted or revoked */
  private async pruneInvitedNumbers() {
    const numbers = await this.getInvitedNumbers();
    const pniServiceIds = Object.keys(numbers);
    if (!pniServiceIds.length) return;

    const pending = new Set((await this.db.getConversations())
      .flatMap(({ groupState }) => groupState?.pendingMembers.map(({ serviceId }) => serviceId) ?? []));
    const kept = pniServiceIds.filter((serviceId) => pending.has(serviceId));
    if (kept.length === pniServiceIds.length) return;
    await this.client.store.setItem('invitedNumbers', Object.fromEntries(kept.map((id) => [id, numbers[id]])));
  }

  /** The numbers of users invited to groups by PNI, by PNI service id */
  async getInvitedNumbers() {
    return await this.client.store.getItem('invitedNumbers') ?? {};
  }

  /**
   * Like `lookUpPhoneNumber`, but a number whose account the enclave knows by PNI only, because the user does not
   * share the ACI, comes back as `pniServiceId`. Such a user can be invited to a group (Signal Desktop
   * `lookupConversationWithoutServiceId`, which keeps such a user as a conversation with a PNI). The group lists
   * the PNI alone, so `saveInvitedNumber` keeps the number once the invitation went through.
   */
  async resolvePhoneNumber(
    e164: string,
  ): Promise<{ conversation?: ConversationRecord; pniServiceId?: string } | undefined> {
    const known = (await this.db.getConversations()).find((conversation) => (
      conversation.type === 'private' && conversation.e164 === e164
    ));
    if (known) return { conversation: known };

    const { connection } = this.client.getSenderContext();
    const records = await lookUpE164s(connection, [e164], await this.getAcisAndAccessKeys());
    const { aci, pni } = records.get(e164) ?? {};
    if (!aci) {
      if (!pni) return undefined;
      return { pniServiceId: toPniServiceId(pni) };
    }
    const conversation = await this.runSerial(async () => {
      const existing = await this.ensurePrivateConversation(aci);
      return existing.e164 === e164 ? existing : this.putConversation({ ...existing, e164 });
    });
    this.flush();
    return { conversation };
  }

  private async ensurePrivateConversation(aci: string) {
    const existing = await this.db.getConversation(aci);
    if (existing) return existing;
    const created = await this.putConversation({
      id: aci, localId: await this.db.allocateLocalId(), type: 'private', unreadCount: 0,
    });
    // Profiles need the connection; our own conversation is created before it, and its profile is fetched after
    if (this.client.isConnected) this.queueProfileRefresh(aci);
    return created;
  }

  private async getOrCreateGroupConversation(masterKey: Uint8Array, revision: number) {
    const id = getGroupId(masterKey);
    const existing = await this.db.getConversation(id);
    const conversation = existing ?? await this.ensureGroupConversation(masterKey);
    if (!existing || (existing.revision ?? -1) < revision) void this.refreshGroup(id, masterKey);
    return conversation;
  }

  private async ensureGroupConversation(masterKey: Uint8Array) {
    const id = getGroupId(masterKey);
    return await this.db.getConversation(id) ?? this.putConversation({
      id, localId: await this.db.allocateLocalId(), type: 'group', masterKey, unreadCount: 0,
    });
  }

  /**
   * Brings the group of a data or story message to the revision of the message before the message is handled, as
   * `maybeUpdateGroup` of Signal Desktop does (`ts/messages/handleDataMessage.preload.ts`): the membership checks
   * of `getIsGroupMessageDropped` need the state the message was sent with. A group we are not part of leaves no
   * conversation. A change of the next revision in the message is applied by `getGroupConversationForMessage`
   * instead. This runs outside the serial queue, which refreshes use.
   */
  private async loadMessageGroup({ content: { content: body } }: DecryptedEnvelope) {
    const sent = body.case === 'syncMessage' && body.value.content.case === 'sent'
      ? body.value.content.value
      : undefined;
    const context = body.case === 'dataMessage' ? body.value.groupV2
      : body.case === 'storyMessage' ? body.value.group
        : sent?.message?.groupV2 ?? sent?.storyMessage?.group;
    if (!context?.masterKey.length) return;

    const { masterKey, revision, groupChange } = context;
    const id = getGroupId(masterKey);
    const getIsBehind = async () => {
      const state = (await this.db.getConversation(id))?.groupState;
      return !state || (revision > state.revision && !(groupChange.length && revision === state.revision + 1));
    };

    let isFailed = false;
    try {
      if (!await getIsBehind()) return;
      const isRunning = this.groupRefreshes.has(id);
      await this.refreshGroup(id, masterKey);
      // A refresh that was running began before the message came, so its state may lack the message's revision
      if (isRunning && await getIsBehind()) await this.refreshGroup(id, masterKey);
    } catch (err) {
      isFailed = true;
      this.events.onError(err as Error);
    }
    // Without a state to check the message against, the message is let through, and a later refresh fills it in
    if (isFailed) await this.runSerial(() => this.ensureGroupConversation(masterKey));
  }

  /**
   * A group message at the next revision with its signed change applies the change and adds its notices
   * (Signal Desktop `updateGroupViaSingleChange`); `loadMessageGroup` fetched the state for other new revisions.
   * Returns `undefined` for a message that is dropped.
   */
  private async getGroupConversationForMessage(source: MessageSource, context: GroupContextV2) {
    const conversation = await this.updateGroupForMessage(source, context);
    return conversation && !(await this.getIsGroupMessageDropped(conversation, source)) ? conversation : undefined;
  }

  private async updateGroupForMessage(source: MessageSource, context: GroupContextV2) {
    const { masterKey, revision, groupChange } = context;
    const existing = await this.db.getConversation(getGroupId(masterKey));
    // Groups we are not part of have no conversation, except for messages of our other devices
    if (!existing && !source.isOutgoing) return undefined;
    const state = existing?.groupState;
    if (!existing || !state || !groupChange.length || revision !== state.revision + 1) {
      return this.getOrCreateGroupConversation(masterKey, revision);
    }

    const change = this.readGroupChange(existing, groupChange);
    if (change?.revision !== revision) return this.getOrCreateGroupConversation(masterKey, revision);
    const { aci: selfAci } = await this.getAccount();
    const next = applyGroupChange(state, change);
    const updated = await this.storeGroupState(existing, next, {
      change, isOutgoing: source.isOutgoing, sentAt: source.sentAt,
    });
    // A state we kept while not a member, as when we asked to join, lacks the members
    const isMember = (group: GroupState) => group.members.some(({ aci }) => aci === selfAci);
    if (!isMember(state) && isMember(next)) void this.refreshGroup(existing.id, masterKey);
    return updated;
  }

  /**
   * Whether a group message is dropped (Signal Desktop `handleDataMessage`): an incoming one when we or the sender
   * are not members of the group, and any when the group is announcements-only and the sender is no admin. Groups
   * with no known state let messages through.
   */
  private async getIsGroupMessageDropped(conversation: ConversationRecord, source: MessageSource) {
    const state = conversation.groupState;
    if (!state) return false;

    const { aci: selfAci } = await this.getAccount();
    const isMember = (aci: string) => state.members.some((member) => member.aci === aci);
    if (!source.isOutgoing && (!isMember(selfAci) || !isMember(source.authorAci))) return true;
    return Boolean(state.isAnnouncementsOnly) && !conversation.adminAcis?.includes(source.authorAci);
  }

  /** The decrypted change of a group message, or `undefined` when it is invalid or of a later change epoch */
  private readGroupChange(conversation: ConversationRecord, groupChange: Uint8Array) {
    try {
      const actions = verifyGroupChange(fromBinary(GroupChangeSchema, groupChange), conversation.id);
      const secretParams = wasm.GroupSecretParams_DeriveFromMasterKey(conversation.masterKey!);
      return actions && decryptGroupChange(secretParams, actions);
    } catch (err) {
      this.events.onError(err as Error);
      return undefined;
    }
  }

  /**
   * Stores a group state that this device led to: after our change, whose notices are ours, or of a group we
   * created (`isCreated` adds its notice) or joined, whose conversation starts here. `isFetched` marks a state
   * that was fetched after the change, rather than made from it.
   */
  applyGroupState(
    masterKey: Uint8Array,
    state: GroupState,
    { change, isCreated, isFetched }: { change?: DecryptedGroupChange; isCreated?: boolean; isFetched?: boolean },
  ) {
    return this.runSerial(async () => {
      const id = getGroupId(masterKey);
      const { aci: selfAci } = await this.getAccount();
      const existing = await this.db.getConversation(id);
      // A newer state comes from the group log, which added the notices of the change as well
      const storedRevision = existing?.groupState?.revision ?? -1;
      if (storedRevision > state.revision || (change && storedRevision === state.revision)) return existing!;
      // Groups we create, join or ask to join are past the message request (`messageRequests.ts`)
      const isJoining = !existing || isCreated || [
        ...change?.addMembers ?? [], ...change?.promotePendingMembers ?? [], ...change?.addRequestingMembers ?? [],
      ].some(({ aci }) => aci === selfAci);
      const conversation = existing ?? await this.putConversation({
        id, localId: await this.db.allocateLocalId(), type: 'group', masterKey, unreadCount: 0,
      });
      const sentAt = this.allocateTimestamp();
      const updated = await this.storeGroupState(
        isJoining ? { ...conversation, isAccepted: true } : conversation,
        state,
        change && {
          change, isOutgoing: true, sentAt, isFetched,
        },
      );
      if (!isCreated) return updated;

      const { conversation: withNotice } = await this.addMessage(updated, {
        conversationId: id,
        kind: 'groupUpdate',
        authorAci: '',
        actorAci: (await this.getAccount()).aci,
        groupUpdate: { type: 'create' },
        sentAt,
        receivedAt: sentAt,
        isOutgoing: true,
        readAt: sentAt,
      });
      return withNotice;
    });
  }

  /**
   * Tells the members, and invited users with an ACI, about a new revision. `groupChange` is the signed change
   * that led to it; `extraRecipients` are people the change concerns who are no longer in the group. The update is
   * not urgent, and recipients it does not reach get it again after the next connection
   * (Signal Desktop `ts/jobs/helpers/sendGroupUpdate.preload.ts`).
   */
  async sendGroupUpdate(id: string, groupChange?: Uint8Array, extraRecipients: string[] = []) {
    const account = await this.getAccount();
    const conversation = await this.db.getConversation(id);
    const state = conversation?.groupState;
    if (!conversation || !state) throw new Error(`Unknown group ${id}`);

    const recipients = new Set([
      ...state.members.map(({ aci }) => aci),
      ...state.pendingMembers.map(({ serviceId }) => serviceId).filter((serviceId) => ACI_PATTERN.test(serviceId)),
      ...extraRecipients,
    ]);
    recipients.delete(account.aci);
    const timestamp = this.allocateTimestamp();
    const message = createOutgoingDataMessage(account, conversation, {}, timestamp, false);
    if (groupChange) message.groupV2!.groupChange = groupChange;

    return this.sendWithRetry(conversation, [...recipients], { case: 'dataMessage', value: message }, timestamp);
  }

  /**
   * Sends a message that is not urgent and has no record of its own, such as a group update or a timer change,
   * and sends it once more to the recipients it did not reach after the next connection
   */
  private async sendWithRetry(
    conversation: ConversationRecord, recipients: string[], content: OutgoingMessage, timestamp: number,
  ) {
    const options = { timestamp, isUrgent: false, shouldIncludeFormerMembers: true };
    const results = await this.sendContentTo(conversation, recipients, content, options);
    // Users that left the registry do not come back
    const failed = results.filter(({ error }) => error && !(error instanceof UnregisteredUserError))
      .map(({ serviceId }) => serviceId);
    if (failed.length) {
      this.pendingSends.push(async () => {
        await this.sendContentTo(conversation, failed, content, options);
      });
    }
    return results;
  }

  /**
   * Brings a group to its current revision outside the envelope queue, with its send endorsements, when one
   * change does not reach it. Members apply each change of the group log with its notices; others, and members
   * whose log cannot be applied, fetch the state. A group we have no conversation with starts one. Concurrent
   * refreshes of a group share one request.
   */
  refreshGroup(id: string, masterKey: Uint8Array) {
    const running = this.groupRefreshes.get(id);
    if (running) return running;

    const refresh = (async () => {
      const { account, store } = this.client.getSenderContext();
      const secretParams = wasm.GroupSecretParams_DeriveFromMasterKey(masterKey);
      const known = (await this.db.getConversation(id))?.groupState;
      const isMember = known?.members.some(({ aci }) => aci === account.aci);

      let result: GroupRefreshResult;
      try {
        const caughtUp = isMember
          ? await this.applyGroupLog(id, secretParams, known!.revision).catch((err) => {
            // The state request below tells whether we lost access
            if (!getIsGroupAccessDenied(err)) this.events.onError(err);
          })
          : undefined;
        result = caughtUp ?? await this.storeFetchedGroup(id, masterKey);
      } catch (err) {
        if (!getIsGroupAccessDenied(err)) throw err;
        result = await this.storeLeftGroup(id);
      }

      const { conversation, members, sendEndorsementsResponse } = result;
      if (members) {
        // Without endorsements, group sends go to each member, so the refresh still counts
        await saveGroupSendEndorsements(store, account.aci, id, secretParams, members, sendEndorsementsResponse)
          .catch(this.events.onError);
      }
      return conversation;
    })();

    this.groupRefreshes.set(id, refresh);
    refresh.catch(this.events.onError).finally(() => this.groupRefreshes.delete(id));
    return refresh;
  }

  /** Stores the fetched group state unless a change applied meanwhile is newer; returns the members it stored */
  private async storeFetchedGroup(id: string, masterKey: Uint8Array) {
    const { account, connection } = this.client.getSenderContext();
    // The server answers only members and invited users, so the group is ours
    const { state, sendEndorsementsResponse } = await fetchGroup(account, connection, masterKey);
    return this.runSerial(async () => {
      const existing = await this.db.getConversation(id);
      if ((existing?.groupState?.revision ?? -1) > state.revision) return { conversation: existing };
      const conversation = existing ?? await this.putConversation({
        id, localId: await this.db.allocateLocalId(), type: 'group', masterKey, unreadCount: 0,
      });
      return {
        conversation: await this.storeGroupState(conversation, state),
        members: state.members.map(({ aci }) => aci),
        sendEndorsementsResponse,
      };
    });
  }

  /**
   * Stores that we lost access to a group we were in, as the server answers 403: the state without us and a notice
   * that we were removed (Signal Desktop `generateLeftGroupChanges`)
   */
  private async storeLeftGroup(id: string) {
    return this.runSerial(async () => {
      const { aci } = await this.getAccount();
      const conversation = await this.db.getConversation(id);
      const state = conversation?.groupState;
      if (!conversation || !state?.members.some((member) => member.aci === aci)) return { conversation };

      const stored = await this.storeGroupState(conversation, {
        ...state,
        members: state.members.filter((member) => member.aci !== aci),
      });
      const now = Date.now();
      const { conversation: updated } = await this.addMessage(stored, {
        conversationId: id,
        kind: 'groupUpdate',
        authorAci: '',
        groupUpdate: { type: 'memberRemoved', aci },
        sentAt: now,
        receivedAt: now,
        isOutgoing: false,
        readAt: now,
      });
      return { conversation: updated, members: [] };
    });
  }

  /**
   * Applies the changes after `fromRevision` from the group log, each with its notices; the state of the last
   * revision then replaces what the changes made (Signal Desktop `integrateGroupChanges`)
   */
  private async applyGroupLog(id: string, secretParams: Uint8Array, fromRevision: number) {
    const { account, connection } = this.client.getSenderContext();
    const { entries, sendEndorsementsResponse } = await fetchGroupLog(account, connection, secretParams, fromRevision);
    return this.runSerial(async () => {
      let conversation = (await this.db.getConversation(id))!;
      let state = conversation.groupState!;
      for (const { change, state: revisionState } of entries) {
        const actions = change?.actions.length ? fromBinary(GroupChange_ActionsSchema, change.actions) : undefined;
        const revision = actions?.version ?? revisionState?.version ?? -1;
        if (revision <= state.revision) continue;

        if (actions && revision === state.revision + 1) {
          const decrypted = decryptGroupChange(secretParams, actions);
          state = applyGroupChange(state, decrypted);
          conversation = await this.storeGroupState(conversation, state, {
            change: decrypted, isOutgoing: decrypted.sourceServiceId === account.aci, sentAt: Date.now(),
          });
        } else if (revisionState) {
          state = decryptGroupState(secretParams, revisionState);
          conversation = await this.storeGroupState(conversation, state);
        } else {
          throw new Error(`Group log of ${id} misses revision ${state.revision + 1}`);
        }
      }

      const last = entries[entries.length - 1]?.state;
      if (last?.version === state.revision) {
        state = decryptGroupState(secretParams, last);
        conversation = await this.storeGroupState(conversation, state);
      }
      return { conversation, members: state.members.map(({ aci }) => aci), sendEndorsementsResponse };
    });
  }

  /**
   * Stores a group state and the profile keys it brings; a change adds its notices. A fetched state, which is
   * not made by applying `applied.change`, only fills in profile keys we lack, as Signal Desktop `applyGroupState`
   * does: a key of a change is new, but one in the state may be older than what a member sent us directly.
   */
  private async storeGroupState(
    conversation: ConversationRecord,
    state: GroupState,
    applied?: { change: DecryptedGroupChange; isOutgoing: boolean; sentAt: number; isFetched?: boolean },
  ) {
    const { aci: selfAci } = await this.getAccount();
    const { store } = this.client;
    for (const { aci, profileKey } of applied ? getChangeProfileKeys(applied.change) : []) {
      if (aci !== selfAci) await saveProfileKey(store, aci, profileKey);
    }
    if (!applied || applied.isFetched) {
      for (const { aci, profileKey } of [...state.members, ...state.requestingMembers]) {
        if (profileKey && aci !== selfAci && !(await store.getRecipient(aci))?.profileKey) {
          await saveProfileKey(store, aci, profileKey);
        }
      }
    }

    let updated = await this.putConversation({
      ...conversation,
      revision: state.revision,
      title: state.title,
      description: state.description,
      memberAcis: state.members.map(({ aci }) => aci),
      adminAcis: state.members.filter(({ role }) => role === Member_Role.ADMINISTRATOR).map(({ aci }) => aci),
      expireTimer: state.expireTimer || undefined,
      isAnnouncementsOnly: state.isAnnouncementsOnly,
      avatarPath: state.avatarUrl,
      groupState: state,
    });
    await this.pruneInvitedNumbers();
    if (!applied) return updated;

    const { change, isOutgoing, sentAt } = applied;
    const now = Date.now();
    const base = {
      conversationId: updated.id, authorAci: '', sentAt, receivedAt: now, isOutgoing, readAt: now,
    };
    for (const { actorAci, update } of buildGroupNotices(change)) {
      ({ conversation: updated } = await this.addMessage(updated, {
        ...base, kind: 'groupUpdate', actorAci, groupUpdate: update,
      }));
    }
    if (change.expireTimer) {
      ({ conversation: updated } = await this.addMessage(updated, {
        ...base, kind: 'timerUpdate', actorAci: change.sourceServiceId, expireTimer: change.expireTimer.value,
      }));
    }
    return updated;
  }

  /**
   * Private conversations take the disappearing timer of each message, unless its version is older than
   * the one we have or it has none while we have one. Groups keep the timer in their state, so their messages
   * do not change it.
   */
  private async updateExpireTimer(conversation: ConversationRecord, source: MessageSource, message: DataMessage) {
    const timer = message.expireTimer || undefined;
    const version = message.expireTimerVersion || undefined;
    const currentVersion = conversation.expireTimerVersion;
    if (conversation.type === 'group' || conversation.expireTimer === timer) return conversation;
    // Messages from clients without timer versions cannot override a versioned timer
    if (currentVersion && (!version || version < currentVersion)) return conversation;

    const updated = await this.putConversation({
      ...conversation,
      expireTimer: timer,
      expireTimerVersion: version ?? conversation.expireTimerVersion,
    });
    const { conversation: withNotice } = await this.addMessage(updated, {
      conversationId: updated.id,
      kind: 'timerUpdate',
      authorAci: '',
      actorAci: source.authorAci,
      sentAt: source.sentAt,
      receivedAt: Date.now(),
      isOutgoing: source.isOutgoing,
      expireTimer: timer,
      readAt: Date.now(),
    });
    return withNotice;
  }

  private async applyReaction(source: MessageSource, reaction: NonNullable<DataMessage['reaction']>) {
    const targetAci = reaction.targetAuthorAci || uuidToString(reaction.targetAuthorAciBinary);
    const target = await this.db.findMessage(targetAci, Number(reaction.targetSentTimestamp));
    if (!target || target.deletedAt) return;

    await this.putReaction(target, source.authorAci, reaction.remove ? undefined : {
      emoji: reaction.emoji, authorAci: source.authorAci, sentAt: source.sentAt,
    });
  }

  /** Replaces the reaction of `authorAci` on a message; Signal keeps one reaction per person */
  private putReaction(message: MessageRecord, authorAci: string, reaction?: MessageReaction) {
    const others = (message.reactions ?? []).filter((current) => current.authorAci !== authorAci);
    return this.putMessage({ ...message, reactions: reaction ? [...others, reaction] : others });
  }

  /** Remote deletes are allowed only to the author, or to group admins through `adminDelete` */
  private async applyDelete(authorAci: string, targetSentAt: number, adminAci?: string) {
    const target = await this.db.findMessage(authorAci, targetSentAt);
    if (!target) {
      // Stories are deleted by their authors only (Signal Desktop `deleteStoryForEveryone`)
      const story = adminAci ? undefined : await this.db.findStory(authorAci, targetSentAt);
      if (story) await this.removeStory(story);
      return;
    }
    if (target.deletedAt) return;
    await this.putMessage({
      ...target,
      deletedByAdminAci: adminAci !== authorAci ? adminAci : undefined,
      dataMessage: undefined,
      revisions: undefined,
      body: undefined,
      reactions: undefined,
      deletedAt: Date.now(),
    });
  }

  private async applyPollVote(voterAci: string, message: DataMessage) {
    const vote = message.pollVote!;
    const target = await this.db.findMessage(
      uuidToString(vote.targetAuthorAciBinary), Number(vote.targetSentTimestamp),
    );
    if (!target || target.isPollEnded) return;

    const existing = target.pollVotes?.find(({ authorAci }) => authorAci === voterAci);
    if (existing && existing.voteCount >= vote.voteCount) return;
    await this.putMessage({
      ...target,
      pollVotes: [
        ...(target.pollVotes ?? []).filter(({ authorAci }) => authorAci !== voterAci),
        { authorAci: voterAci, optionIndexes: vote.optionIndexes, voteCount: vote.voteCount },
      ],
    });
  }

  /**
   * Pins or unpins a message of the conversation when the sender may edit the group (Signal Desktop
   * `ts/messageModifiers/PinnedMessages.preload.ts`)
   */
  private async applyPin(conversation: ConversationRecord, senderAci: string, message: DataMessage) {
    const target = message.pinMessage ?? message.unpinMessage!;
    const targetMessage = await this.db.findMessage(
      uuidToString(target.targetAuthorAciBinary), Number(target.targetSentTimestamp),
    );
    if (!targetMessage || targetMessage.conversationId !== conversation.id || !getIsMessagePinnable(targetMessage)
      || !getCanPinMessages(conversation, senderAci)) {
      return;
    }

    const pin = message.pinMessage;
    const now = Date.now();
    await this.putConversation({
      ...conversation,
      pinnedMessages: pin
        ? addPinnedMessage(conversation.pinnedMessages, {
          messageId: targetMessage.id,
          pinnedAt: now,
          expiresAt: pin.pinDuration.case === 'pinDurationSeconds' ? now + pin.pinDuration.value * 1000 : undefined,
        })
        : conversation.pinnedMessages?.filter(({ messageId }) => messageId !== targetMessage.id),
    });
  }

  /** A read on another device covers every earlier message of the conversation too */
  private async applyReadSync(authorAci: string, sentAt: number, source: MessageSource) {
    const target = await this.db.findMessage(authorAci, sentAt);
    if (!target) return;

    const readAt = source.serverTimestamp ?? Date.now();
    for (const message of await this.db.getUnreadMessages(target.conversationId, target.id)) {
      await this.putMessage({
        ...message,
        readAt,
        expiresAt: message.expireTimer ? readAt + message.expireTimer * 1000 : undefined,
      });
    }
    const conversation = await this.db.getConversation(target.conversationId);
    if (conversation) {
      const unreadCount = (await this.db.getUnreadMessages(target.conversationId)).length;
      await this.putConversation({ ...conversation, unreadCount, isMarkedUnread: false });
    }
    this.scheduleExpiration();
  }

  private async applyContactSync(data: Uint8Array) {
    for (const contact of parseContactSync(data)) {
      if (!contact.aci) continue;
      const conversation = await this.ensurePrivateConversation(contact.aci);
      await this.putConversation({
        ...conversation,
        e164: contact.number ?? conversation.e164,
        systemName: contact.name ?? conversation.systemName,
      });
    }
  }

  /** The primary device sends its whole blocked list, which replaces ours */
  private async applyBlockedSync(blocked: NonNullable<Extract<SyncMessage['content'], { case: 'blocked' }>['value']>) {
    const blockedIds = new Set([
      ...blocked.acis,
      ...blocked.acisBinary.map(uuidToString),
      ...blocked.blockedAcis.map(({ aciBinary }) => uuidToString(aciBinary)),
      ...blocked.groupIds.map(bufferToBase64),
      ...blocked.blockedGroups.map(({ groupId }) => bufferToBase64(groupId)),
    ]);
    const blockedE164s = new Set([...blocked.numbers, ...blocked.blockedE164s.map(({ e164 }) => e164)]);
    blockedE164s.delete('');
    const unknownE164s = new Set(blockedE164s);

    for (const conversation of await this.db.getConversations()) {
      const isBlocked = blockedIds.has(conversation.id)
        || Boolean(conversation.e164 && blockedE164s.has(conversation.e164));
      if (Boolean(conversation.isBlocked) !== isBlocked) await this.putConversation({ ...conversation, isBlocked });
      blockedIds.delete(conversation.id);
      if (conversation.e164) unknownE164s.delete(conversation.e164);
    }
    // Unknown groups need their master key, so only private conversations are created here
    for (const id of blockedIds) {
      if (!ACI_PATTERN.test(id)) continue;
      const conversation = await this.ensurePrivateConversation(id);
      await this.putConversation({ ...conversation, isBlocked: true });
    }
    await this.client.store.setItem('blockedE164s', [...unknownE164s]);
  }

  /**
   * Sends our whole blocked list as it is at send time (Signal Desktop `getBlockSync` in
   * `ts/textsecure/SendMessage.preload.ts`)
   */
  private async sendBlockedList(context: SenderContext) {
    const blocked = (await this.db.getConversations()).filter(({ isBlocked }) => isBlocked);
    const acis = blocked.filter(({ type }) => type === 'private').map(({ id }) => id);
    const groupIds = blocked.filter(({ type }) => type === 'group').map(({ id }) => bufferFromBase64(id));
    const e164s = [...new Set([
      ...await this.client.store.getItem('blockedE164s') ?? [],
      ...blocked.map(({ e164 }) => e164).filter(Boolean),
    ])];

    await sendBlockedSync(context, {
      numbers: e164s,
      blockedE164s: e164s.map((e164) => ({ e164 })),
      acis,
      blockedAcis: acis.map((aci) => ({ aciBinary: uuidToBytes(aci) })),
      groupIds,
      blockedGroups: groupIds.map((groupId) => ({ groupId })),
    });
  }

  /** The delete is done here either way, so a failed sync is only reported */
  private async syncDeleteForMe(deleteForMe: MessageInitShape<typeof SyncMessage_DeleteForMeSchema>) {
    await this.sendWhenConnected(async (context) => {
      await sendDeleteForMeSync(context, deleteForMe);
    }).catch(this.events.onError);
  }

  private async applyMessageRequestResponseSync(
    response: NonNullable<Extract<SyncMessage['content'], { case: 'messageRequestResponse' }>['value']>,
  ) {
    const id = response.groupId.length
      ? bufferToBase64(response.groupId)
      : response.threadAci || uuidToString(response.threadAciBinary);
    const conversation = await this.db.getConversation(id);
    if (conversation) await this.applyMessageRequestResponse(conversation, response.type);
  }

  /**
   * Accepting unblocks and shares our profile; blocking and deleting stop sharing it; spam marks the conversation
   * reported (`applyMessageRequestResponse` in Signal Desktop `ts/models/conversations.preload.ts`)
   */
  private async applyMessageRequestResponse(conversation: ConversationRecord, type: MessageRequestResponseType) {
    const isAccept = type === SyncMessage_MessageRequestResponse_Type.ACCEPT;
    const isBlock = BLOCK_RESPONSES.has(type);
    const isDelete = DELETE_RESPONSES.has(type);

    if (isDelete) await this.deleteMessagesUpTo(conversation.id);
    return this.putConversation({
      ...conversation,
      isAccepted: isAccept || (!isBlock && !isDelete && conversation.isAccepted),
      isBlocked: !isAccept && (isBlock || conversation.isBlocked),
      isReported: SPAM_RESPONSES.has(type) || conversation.isReported,
      unreadCount: isDelete ? 0 : conversation.unreadCount,
      isMarkedUnread: isDelete ? false : conversation.isMarkedUnread,
      lastMessageId: isDelete ? undefined : conversation.lastMessageId,
    });
  }

  /** Signal Desktop `onDeleteForMeSync` in `ts/background.preload.ts` and `ts/util/deleteForMe.preload.ts` */
  private async applyDeleteForMeSync(deleteForMe: SyncMessage_DeleteForMe) {
    const changedIds = new Set<string>();

    for (const { conversation: identifier, messages } of deleteForMe.messageDeletes) {
      const conversation = await this.findConversation(identifier);
      if (!conversation) continue;
      for (const target of messages) {
        const message = await this.findAddressableMessage(conversation.id, target);
        if (message) await this.removeMessage(message);
      }
      changedIds.add(conversation.id);
    }

    for (const item of deleteForMe.conversationDeletes) {
      const conversation = await this.findConversation(item.conversation);
      if (!conversation) continue;
      // Disappearing messages may be gone here, so the latest lasting ones mark the end too
      const newest = await this.findNewestMessage(conversation.id, item.mostRecentMessages)
        ?? await this.findNewestMessage(conversation.id, item.mostRecentNonExpiringMessages);
      if (newest) await this.deleteMessagesUpTo(conversation.id, newest.id);
      if (item.isFullDelete) await this.deleteLocalOnlyConversation(conversation.id);
      changedIds.add(conversation.id);
    }

    for (const { conversation: identifier } of deleteForMe.localOnlyConversationDeletes) {
      const conversation = await this.findConversation(identifier);
      if (!conversation) continue;
      await this.deleteLocalOnlyConversation(conversation.id);
      changedIds.add(conversation.id);
    }

    for (const item of deleteForMe.attachmentDeletes) {
      const conversation = await this.findConversation(item.conversation);
      const message = conversation && item.targetMessage
        && await this.findAddressableMessage(conversation.id, item.targetMessage);
      if (message?.dataMessage) await this.deleteAttachment(message, item.clientUuid, item.fallbackDigest);
    }

    for (const id of changedIds) await this.updateLastMessage(id);
  }

  /** Removes the attachment with `clientUuid`, or else the one with `digest` (Signal Desktop `deleteAttachmentFromMessage`) */
  private async deleteAttachment(message: MessageRecord, clientUuid: Uint8Array, digest: Uint8Array) {
    const dataMessage = fromBinary(DataMessageSchema, message.dataMessage!);
    const { attachments } = dataMessage;
    let index = clientUuid.length ? attachments.findIndex((item) => buffersEqual(item.clientUuid, clientUuid)) : -1;
    if (index === -1 && digest.length) index = attachments.findIndex((item) => buffersEqual(item.digest, digest));
    if (index === -1) return;

    attachments.splice(index, 1);
    await this.putMessage({ ...message, dataMessage: toBinary(DataMessageSchema, dataMessage) });
  }

  /** A conversation with no message that other devices could name loses its remaining notices */
  private async deleteLocalOnlyConversation(conversationId: string) {
    const [addressable] = await this.db.findLatestMessages(conversationId, 1, isAddressableMessage);
    if (!addressable) await this.deleteMessagesUpTo(conversationId);
  }

  private async findConversation(identifier?: ConversationIdentifier) {
    const { case: kind, value } = identifier?.identifier ?? {};
    switch (kind) {
      case 'threadServiceId':
        return this.db.getConversation(value as string);
      case 'threadServiceIdBinary':
        // A 17-byte value is a PNI, which has no conversation here
        return (value as Uint8Array).length === UUID_BYTE_LENGTH
          ? this.db.getConversation(uuidToString(value as Uint8Array))
          : undefined;
      case 'threadGroupId':
        return this.db.getConversation(bufferToBase64(value as Uint8Array));
      case 'threadE164':
        return (await this.db.getConversations()).find(({ e164 }) => e164 === value);
      default:
        return undefined;
    }
  }

  private async findAddressableMessage(conversationId: string, target: AddressableMessage) {
    const { case: kind, value } = target.author;
    let authorAci: string | undefined;
    if (kind === 'authorServiceId') {
      authorAci = value;
    } else if (kind === 'authorServiceIdBinary' && value.length === UUID_BYTE_LENGTH) {
      authorAci = uuidToString(value);
    } else if (kind === 'authorE164') {
      authorAci = (await this.db.getConversations()).find(({ type, e164 }) => type === 'private' && e164 === value)?.id;
    }
    if (!authorAci || !target.sentTimestamp) return undefined;

    const message = await this.db.findMessage(authorAci, Number(target.sentTimestamp));
    return message?.conversationId === conversationId ? message : undefined;
  }

  /** The newest of the named messages that is still here; ids grow in arrival order */
  private async findNewestMessage(conversationId: string, targets: AddressableMessage[]) {
    let newest: MessageRecord | undefined;
    for (const target of targets) {
      const message = await this.findAddressableMessage(conversationId, target);
      if (message && (!newest || message.id > newest.id)) newest = message;
    }
    return newest;
  }

  private async removeMessage(message: MessageRecord) {
    await this.db.deleteMessage(message.id);
    this.changes.deletedMessages.push({ conversationId: message.conversationId, id: message.id });
  }

  /** Deletes the messages of a conversation up to `maxId`, every message by default */
  private async deleteMessagesUpTo(conversationId: string, maxId?: number) {
    for (const id of await this.db.deleteConversationMessages(conversationId, maxId)) {
      this.changes.deletedMessages.push({ conversationId, id });
    }
  }

  /** Points the conversation at its latest remaining message and recounts unread ones after deletes */
  private async updateLastMessage(conversationId: string) {
    const conversation = await this.db.getConversation(conversationId);
    if (!conversation) return undefined;
    const [last] = await this.db.getMessages(conversationId, 1);
    const unreadCount = (await this.db.getUnreadMessages(conversationId)).length;
    if (last?.id === conversation.lastMessageId && unreadCount === conversation.unreadCount) return conversation;
    return this.putConversation({
      ...conversation,
      lastMessageId: last?.id,
      lastMessageAt: last?.sentAt ?? conversation.lastMessageAt,
      unreadCount,
      isMarkedUnread: last ? conversation.isMarkedUnread : false,
    });
  }

  private async addMessage(conversation: ConversationRecord, record: NewMessageRecord) {
    const message = await this.db.addMessage(record);
    this.changes.messages.push(message);
    this.changes.addedMessageIds.push(message.id);
    const isIncoming = !record.isOutgoing && record.kind === 'message';
    const updated = await this.putConversation({
      ...conversation,
      lastMessageId: message.id,
      // A call notice has the time of the call, which can be older than the messages that came since (Desktop keeps the
      // latest time)
      lastMessageAt: record.kind === 'call' ? Math.max(conversation.lastMessageAt ?? 0, record.sentAt) : record.sentAt,
      unreadCount: conversation.unreadCount + (isIncoming ? 1 : 0),
      // New messages bring archived conversations back unless they are muted
      isArchived: conversation.isArchived && isIncoming && !isMuted(conversation) ? false : conversation.isArchived,
    });
    if (record.expiresAt) this.scheduleExpiration();
    return { message, conversation: updated };
  }

  private async putMessage(record: MessageRecord) {
    await this.db.putMessage(record);
    this.changes.messages.push(record);
    if (record.expiresAt) this.scheduleExpiration();
    return record;
  }

  private async putConversation(record: ConversationRecord) {
    await this.db.putConversation(record);
    this.changes.conversations.push(record);
    return record;
  }

  private queueDeliveryReceipt(senderAci: string, sentAt: number) {
    this.deliveryReceipts.set(senderAci, [...this.deliveryReceipts.get(senderAci) ?? [], sentAt]);
    this.deliveryReceiptTimer ??= setTimeout(() => {
      this.deliveryReceiptTimer = undefined;
      const batches = [...this.deliveryReceipts];
      this.deliveryReceipts.clear();
      const context = this.client.getSenderContext();
      for (const [aci, timestamps] of batches) {
        sendReceipts(context, aci, ReceiptMessage_Type.DELIVERY, timestamps).catch(this.events.onError);
      }
    }, DELIVERY_RECEIPT_DELAY_MS);
  }

  /** One timer covers disappearing messages and stories */
  private scheduleExpiration() {
    clearTimeout(this.expirationTimer);
    void Promise.all([this.db.getNextExpiresAt(), this.db.getNextStoryExpiresAt()]).then((times) => {
      const defined = times.filter((time) => time !== undefined);
      if (!defined.length) return;
      const expiresAt = Math.min(...defined);
      this.expirationTimer = setTimeout(() => {
        void this.runSerial(() => this.deleteExpiredMessages()).catch(this.events.onError);
      }, Math.min(Math.max(expiresAt - Date.now(), 0), MAX_TIMEOUT_MS));
    });
  }

  private async deleteExpiredMessages() {
    const now = Date.now();
    for (const message of await this.db.getExpiredMessages(now)) {
      await this.db.deleteMessage(message.id);
      this.changes.deletedMessages.push({ conversationId: message.conversationId, id: message.id });
    }
    for (const story of await this.db.getExpiredStories(now)) await this.removeStory(story);
    this.flush();
    this.scheduleExpiration();
  }

  private runSerial<T>(task: () => Promise<T>): Promise<T> {
    const result = this.serial.then(task);
    this.serial = result.then(() => undefined, () => undefined);
    return result.finally(() => this.flush());
  }

  private flush() {
    const { changes } = this;
    if (!changes.conversations.length && !changes.messages.length && !changes.deletedMessages.length
      && !changes.stories.length && !changes.deletedStories.length && !changes.calls.length) {
      return;
    }
    this.changes = createChanges();
    const deletedStoryIds = new Set(changes.deletedStories.map(({ id }) => id));
    this.events.onChanges({
      conversations: dedupeById(changes.conversations),
      messages: dedupeById(changes.messages),
      addedMessageIds: changes.addedMessageIds,
      deletedMessages: changes.deletedMessages,
      stories: dedupeById(changes.stories).filter(({ id }) => !deletedStoryIds.has(id)),
      deletedStories: changes.deletedStories,
      calls: changes.calls,
    });
  }
}

function createChanges(): MessageChanges {
  return {
    conversations: [],
    messages: [],
    addedMessageIds: [],
    deletedMessages: [],
    stories: [],
    deletedStories: [],
    calls: [],
  };
}

/** A data message from this device; `shouldIncludeTimer` adds the conversation's disappearing timer */
function createOutgoingDataMessage(
  account: AccountRecord,
  conversation: ConversationRecord,
  init: MessageInitShape<typeof DataMessageSchema>,
  timestamp: number,
  shouldIncludeTimer = true,
) {
  const message = create(DataMessageSchema, init);
  setOutgoingFields(message, account, conversation, timestamp);
  if (shouldIncludeTimer) {
    message.expireTimer = conversation.expireTimer ?? 0;
    message.expireTimerVersion = conversation.expireTimerVersion ?? 0;
  }
  return message;
}

/**
 * Sets the fields every data message from this device carries: timestamp, group and, once the message request is
 * accepted, our profile key
 */
function setOutgoingFields(
  message: DataMessage, account: AccountRecord, conversation: ConversationRecord, timestamp: number,
) {
  message.timestamp = BigInt(timestamp);
  message.profileKey = getIsConversationAccepted(conversation, account.aci)
    ? account.profileKey ?? message.profileKey
    : new Uint8Array();
  message.groupV2 = conversation.masterKey
    ? create(GroupContextV2Schema, { masterKey: conversation.masterKey, revision: conversation.revision })
    : undefined;
}

/** Refuses a send to a group that an admin ended */
function assertGroupIsOpen({ id, groupState }: ConversationRecord) {
  if (groupState?.isTerminated) throw new GroupTerminatedError(id);
}

/** Members who receive our messages in a conversation; Note to Self has only us, which sends a sync alone */
function getRecipientAcis(conversation: ConversationRecord, selfAci: string) {
  return conversation.type === 'group'
    ? (conversation.memberAcis ?? []).filter((aci) => aci !== selfAci)
    : [conversation.id];
}

function buildPendingStatus(recipientAcis: string[]): Record<string, SendStatus> {
  return Object.fromEntries(recipientAcis.map((aci) => [aci, 'pending' as const]));
}

/** A recipient without a result got the message through the sync transcript alone (Note to Self) */
function getResultError(results: RecipientResult[], serviceId: string) {
  return results.find((result) => result.serviceId === serviceId)?.error;
}

/** Keeps the last version of each record */
function dedupeById<T extends { id: string | number }>(records: T[]) {
  return [...new Map(records.map((record) => [record.id, record])).values()];
}

/** Messages that other devices can find by author and timestamp; notices have no author */
function isAddressableMessage(message: MessageRecord) {
  return message.kind === 'message' && Boolean(message.authorAci);
}

function buildConversationIdentifier(
  conversation: ConversationRecord,
): MessageInitShape<typeof ConversationIdentifierSchema> {
  return {
    identifier: conversation.type === 'group'
      ? { case: 'threadGroupId', value: bufferFromBase64(conversation.id) }
      : { case: 'threadServiceId', value: conversation.id },
  };
}

function buildAddressableMessage(message: MessageRecord): MessageInitShape<typeof AddressableMessageSchema> {
  return {
    author: { case: 'authorServiceId', value: message.authorAci },
    sentTimestamp: BigInt(message.sentAt),
  };
}

function hasMessageContent(message: DataMessage) {
  return Boolean(message.body || message.attachments.length || message.sticker || message.contact.length
    || message.pollCreate || message.giftBadge || message.payment || message.quote);
}

function isMuted(conversation: ConversationRecord) {
  return Boolean(conversation.mutedUntil && conversation.mutedUntil > Date.now());
}

function maxStatus(current: SendStatus | undefined, next: SendStatus): SendStatus {
  return !current || STATUS_RANK[next] > STATUS_RANK[current] ? next : current;
}

function groupTimestampsByAuthor(messages: MessageRecord[]) {
  const byAuthor = new Map<string, number[]>();
  for (const { authorAci, sentAt } of messages) {
    byAuthor.set(authorAci, [...byAuthor.get(authorAci) ?? [], sentAt]);
  }
  return byAuthor;
}

/**
 * The story message from this device: our profile key goes with every story, as recipients may reply; group stories
 * name their group (Signal Desktop `getStoryMessage` in `ts/textsecure/SendMessage.preload.ts`)
 */
function createOutgoingStoryMessage(
  account: AccountRecord, story: OutgoingStory, allowsReplies: boolean, group?: ConversationRecord,
) {
  return create(StoryMessageSchema, {
    ...story,
    profileKey: account.profileKey,
    allowsReplies,
    group: group?.masterKey ? { masterKey: group.masterKey, revision: group.revision } : undefined,
  });
}

/** Recipients of a sent story as its sync names them */
function buildStoryRecipients(
  recipients: SyncMessage_Sent['storyMessageRecipients'], status: SendStatus,
): Record<string, StoryRecipient> {
  const result: Record<string, StoryRecipient> = {};
  for (const recipient of recipients) {
    const aci = getAci(recipient.destinationServiceId, recipient.destinationServiceIdBinary);
    if (!aci) continue;
    result[aci] = {
      status, isAllowedToReply: recipient.isAllowedToReply, distributionListIds: recipient.distributionListIds,
    };
  }
  return result;
}

/**
 * Whether a reply belongs to a story: our replies and group replies belong to the story of their conversation, and
 * replies to our stories come from recipients who may reply
 */
function getIsStoryReplyAllowed(story: StoryRecord, conversation: ConversationRecord, source: MessageSource) {
  if (source.isOutgoing || conversation.type === 'group') return story.conversationId === conversation.id;
  return story.isOutgoing && Boolean(story.recipients?.[source.authorAci]?.isAllowedToReply);
}

function getIsGroupAccessDenied(err: unknown) {
  return err instanceof GroupRequestError && err.isAccessDenied;
}

/** The fields of `patch` that `existing` has no value for */
function getAbsentFields(existing: ConversationRecord, patch: ConversationPatch): ConversationPatch {
  const absent = { id: patch.id, type: patch.type } as ConversationPatch;
  for (const key of Object.keys(patch) as (keyof ConversationRecord)[]) {
    if (existing[key] === undefined && patch[key] !== undefined) (absent as Record<string, unknown>)[key] = patch[key];
  }
  return absent;
}

/** The conversation id of a group: its base64 group identifier */
export function getGroupId(masterKey: Uint8Array) {
  const secretParams = wasm.GroupSecretParams_DeriveFromMasterKey(masterKey);
  const publicParams = wasm.GroupSecretParams_GetPublicParams(secretParams);
  return bufferToBase64(wasm.GroupPublicParams_GetGroupIdentifier(publicParams));
}

function getManifestIds(manifest: ManifestRecord) {
  return manifest.identifiers.map(({ raw }) => bufferToBase64(raw));
}

/** Leaves out account fields that changed on this device since the last storage write, so local changes win */
function omitAccountChanges(update: OwnAccountUpdate, changedFields: { has(field: AccountStorageField): boolean }) {
  const result = { ...update };
  for (const [key, field] of Object.entries(OWN_ACCOUNT_FIELDS) as [keyof OwnAccountUpdate, AccountStorageField][]) {
    if (changedFields.has(field)) delete result[key];
  }
  return result;
}

/** Contact discovery of storage service contacts is off by default: Signal Desktop never looks up numbers in bulk */
function getIsContactDiscoveryEnabled(account: AccountRecord) {
  return account.deviceId === SIGNAL_PRIMARY_DEVICE_ID && Boolean(account.isContactDiscoveryEnabled);
}

function getNumberOnlyContacts(records: StorageRecord[]) {
  return records
    .map(({ record }) => (record.case === 'contact' ? record.value : undefined))
    .filter((contact): contact is ContactRecord => (
      Boolean(contact?.e164 && !contact.blocked && !getAci(contact.aci, contact.aciBinary))
    ));
}
