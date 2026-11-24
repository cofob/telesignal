import type { ThreadId, ThreadReadState } from '../../types';
import type { RegularLangFnParameters } from '../../util/localization';
import type { ApiCallLogEntry } from './callLog';
import type {
  ApiChat,
  ApiChatFolder,
  ApiChatFullInfo,
  ApiChatMember,
  ApiDraft,
  ApiTypingStatus,
} from './chats';
import type {
  ApiLocalSendError,
  ApiMessage,
  ApiMessagePoll,
  ApiReaction,
  ApiStickerSet,
  ApiThreadInfo,
  ApiWebPage,
} from './messages';
import type {
  ApiError,
  ApiNotifyPeerType,
  ApiPeerNotifySettings,
  ApiSessionData,
} from './misc';
import type { ApiNotificationProfilesState } from './notificationProfiles';
import type { ApiPeerSettings } from './peers';
import type { ApiBackupSettings, ApiPrivacyKey, PrivacyVisibility } from './settings';
import type { ApiStory, ApiStorySkipped } from './stories';
import type {
  ApiUser, ApiUserFullInfo, ApiUserStatus,
} from './users';

export type ApiUpdateReady = {
  '@type': 'updateApiReady';
};

export type ApiUpdateAuthorizationStateType = (
  'authorizationStateLoggingOut' |
  'authorizationStateWaitPhoneNumber' |
  'authorizationStateWaitCode' |
  'authorizationStateWaitPassword' |
  'authorizationStateWaitRegistration' |
  'authorizationStateReady' |
  'authorizationStateClosing' |
  'authorizationStateClosed' |
  'authorizationStateWaitQrCode' |
  'authorizationStateWaitCaptcha' |
  'authorizationStateWaitBackupRestore'
);

export type ApiUpdateConnectionStateType = (
  'connectionStateConnecting' |
  'connectionStateReady' |
  'connectionStateBroken'
);

export type ApiUpdateAuthorizationState = {
  '@type': 'updateAuthorizationState';
  authorizationState: ApiUpdateAuthorizationStateType;
  isCodeViaApp?: boolean;
  hint?: string;
  noReset?: boolean;
  qrCode?: { token: string; expires: number };
  codeInfo?: ApiAuthCodeInfo;
  // Signal link and sync: the link screen shows the message history transfer instead of the QR code
  historySync?: ApiHistorySyncProgress;
  // Signal registration: the step that offers to restore a backup with the recovery key
  backupRestore?: ApiBackupRestoreState;
  // Signal registration: the number being registered, for a page that reloaded during the registration
  phoneNumber?: string;
};

/** A restore of a backup at registration: waiting for the recovery key while `step` is not set */
export type ApiBackupRestoreState = {
  step?: 'verifying' | 'downloading' | 'validating' | 'importing';
  // From 0 to 1, while downloading and importing
  progress?: number;
  // The backup that the recovery key found
  found?: { size: number; modifiedAt?: number };
};

export type ApiHistorySyncProgress = {
  step: 'waiting' | 'downloading' | 'importing';
  // From 0 to 1, while downloading and importing
  progress?: number;
};

/** How the verification code of a Signal registration was sent and when it can be sent again */
export type ApiAuthCodeInfo = {
  transport?: ApiAuthCodeTransport;
  // Local times in milliseconds; absent when the transport cannot be used
  nextSmsAt?: number;
  nextCallAt?: number;
};

export type ApiAuthCodeTransport = 'sms' | 'voice';

export type ApiUpdateSession = {
  '@type': 'updateSession';
  sessionData?: ApiSessionData;
};

export type ApiUpdateAuthorizationError = {
  '@type': 'updateAuthorizationError';
  errorKey: RegularLangFnParameters;
  errorCode?: string;
};

// Signal: the server stopped accepting this device and the engine removed its data; the link screen says why
export type ApiUpdateDeviceDeauthorized = {
  '@type': 'updateDeviceDeauthorized';
  // The phone or another device removed this device, or the number of the primary device was registered elsewhere
  reason: 'unlinked' | 'deregistered';
};

// Signal: the engine read its storage and found no account, so a session that the app stores for the slot is stale
export type ApiUpdateStaleSession = {
  '@type': 'updateStaleSession';
};

export type ApiUpdateConnectionState = {
  '@type': 'updateConnectionState';
  connectionState: ApiUpdateConnectionStateType;
};

export type ApiUpdateCurrentUser = {
  '@type': 'updateCurrentUser';
  currentUser: ApiUser;
  currentUserFullInfo: ApiUserFullInfo;
};

export type ApiUpdateChat = {
  '@type': 'updateChat';
  id: string;
  chat: Partial<ApiChat>;
  readState?: Partial<ThreadReadState>;
  noTopChatsRequest?: boolean;
};

export type ApiUpdateChatLastMessage = {
  '@type': 'updateChatLastMessage';
  id: string;
  lastMessage: ApiMessage;
};

export type ApiUpdateChatJoin = {
  '@type': 'updateChatJoin';
  id: string;
};

export type ApiUpdateChatLeave = {
  '@type': 'updateChatLeave';
  id: string;
};

export type ApiUpdateChatTypingStatus = {
  '@type': 'updateChatTypingStatus';
  id: string;
  peerId: string;
  threadId?: ThreadId;
  typingStatus: ApiTypingStatus | undefined;
};

export type ApiUpdateChatFullInfo = {
  '@type': 'updateChatFullInfo';
  id: string;
  fullInfo: Partial<ApiChatFullInfo>;
};

export type ApiUpdateChatMembers = {
  '@type': 'updateChatMembers';
  id: string;
  replacedMembers?: ApiChatMember[];
  addedMember?: ApiChatMember;
  deletedMemberId?: string;
};

export type ApiUpdateChatParticipantRank = {
  '@type': 'updateChatParticipantRank';
  id: string;
  userId: string;
  rank: string;
};

export type ApiUpdatePinnedChatIds = {
  '@type': 'updatePinnedChatIds';
  ids?: string[];
  folderId?: number;
};

export type ApiUpdateChatListType = {
  '@type': 'updateChatListType';
  id: string;
  folderId: number;
};

export type ApiUpdateChatPinned = {
  '@type': 'updateChatPinned';
  id: string;
  isPinned: boolean;
};

export type ApiUpdateChatFolder = {
  '@type': 'updateChatFolder';
  id: number;
  folder: ApiChatFolder | undefined;
};

export type ApiUpdateChatFoldersOrder = {
  '@type': 'updateChatFoldersOrder';
  orderedIds: number[];
};

export type ApiUpdateNewScheduledMessage = {
  '@type': 'newScheduledMessage';
  chatId: string;
  id: number;
  message: ApiMessage;
  wasDrafted?: boolean;
  poll?: ApiMessagePoll;
  webPages?: ApiWebPage[];
};

export type ApiUpdateNewMessage = {
  '@type': 'newMessage';
  chatId: string;
  id: number;
  message: ApiMessage;
  shouldForceReply?: boolean;
  wasDrafted?: boolean;
  poll?: ApiMessagePoll;
  webPages?: ApiWebPage[];
};

export type ApiUpdateEphemeralMessage = {
  '@type': 'updateEphemeralMessage';
  message: ApiMessage;
  webPages?: ApiWebPage[];
};

export type ApiUpdateMessage = {
  '@type': 'updateMessage';
  chatId: string;
  id: number;
  poll?: ApiMessagePoll;
  webPages?: ApiWebPage[];
  shouldForceReply?: boolean;
  isFromNew?: true;
} & (
  {
    isFull: true;
    message: ApiMessage;
  } | {
    isFull?: false;
    message: Partial<ApiMessage>;
  }
);

export type ApiUpdateScheduledMessage = {
  '@type': 'updateScheduledMessage';
  chatId: string;
  id: number;
  poll?: ApiMessagePoll;
  webPages?: ApiWebPage[];
  isFromNew?: true;
} & (
  {
    isFull: true;
    message: ApiMessage;
  } | {
    isFull?: false;
    message: Partial<ApiMessage>;
  }
);

export type ApiUpdatePinnedMessageIds = {
  '@type': 'updatePinnedIds';
  chatId: string;
  isPinned?: boolean;
  messageIds: number[];
};

export type ApiUpdateThreadInfo = {
  '@type': 'updateThreadInfo';
  threadInfo: ApiThreadInfo;
};

export type ApiUpdateThreadReadState = {
  '@type': 'updateThreadReadState';
  chatId: string;
  threadId: ThreadId;
  readState: Partial<ThreadReadState>;
};

export type ApiUpdateScheduledMessageSendSucceeded = {
  '@type': 'updateScheduledMessageSendSucceeded';
  chatId: string;
  localId: number;
  message: ApiMessage;
  poll?: ApiMessagePoll;
  webPages?: ApiWebPage[];
};

export type ApiUpdateMessageSendSucceeded = {
  '@type': 'updateMessageSendSucceeded';
  chatId: string;
  localId: number;
  message: ApiMessage;
  poll?: ApiMessagePoll;
  webPages?: ApiWebPage[];
};

export type ApiUpdateMessageSendFailed = {
  '@type': 'updateMessageSendFailed';
  chatId: string;
  localId: number;
  error: string;
  sendError?: ApiLocalSendError;
};

// Signal: a message was not sent to some users because their safety numbers changed, until the user accepts them
export type ApiUpdateSafetyNumberBlock = {
  '@type': 'updateSafetyNumberBlock';
  chatId: string;
  messageId: number;
  userIds: string[];
};

export type ApiUpdateScheduledMessageSendFailed = {
  '@type': 'updateScheduledMessageSendFailed';
  chatId: string;
  localId: number;
  error: string;
};

export type ApiUpdateMessagePoll = {
  '@type': 'updateMessagePoll';
  pollId: string;
  pollUpdate: Partial<ApiMessagePoll>;
  webPages?: ApiWebPage[];
};

export type ApiUpdateDeleteMessages = {
  '@type': 'deleteMessages';
  ids: number[];
  chatId?: string;
};

export type ApiUpdateDeleteScheduledMessages = {
  '@type': 'deleteScheduledMessages';
  ids: number[];
  newIds?: number[];
  chatId: string;
};

export type ApiUpdateDeleteHistory = {
  '@type': 'deleteHistory';
  chatId: string;
};

export type ApiUpdateResetMessages = {
  '@type': 'resetMessages';
  id: string;
};

export type ApiUpdateDraftMessage = {
  '@type': 'draftMessage';
  chatId: string;
  threadId?: ThreadId;
  draft?: ApiDraft;
};

export type ApiDeleteContact = {
  '@type': 'deleteContact';
  id: string;
};

export type ApiUpdatePeerSettings = {
  '@type': 'updatePeerSettings';
  id: string;
  settings: ApiPeerSettings;
};

export type ApiUpdatePeerHistoryTtl = {
  '@type': 'updatePeerHistoryTtl';
  id: string;
  ttlPeriod?: number;
};

export type ApiUpdateUser = {
  '@type': 'updateUser';
  id: string;
  user: Partial<ApiUser>;
  fullInfo?: ApiUserFullInfo;
};

export type ApiUpdateRequestUserUpdate = {
  '@type': 'updateRequestUserUpdate';
  id: string;
};

export type ApiUpdateUserStatus = {
  '@type': 'updateUserStatus';
  userId: string;
  status: ApiUserStatus;
};

export type ApiUpdateUserFullInfo = {
  '@type': 'updateUserFullInfo';
  id: string;
  fullInfo: Partial<ApiUserFullInfo>;
};

export type ApiUpdateAvatar = {
  '@type': 'updateAvatar';
  chatId: string;
  dataUri: string;
};

export type ApiUpdateMessageImage = {
  '@type': 'updateMessageImage';
  messageId: number;
  dataUri: string;
};

export type ApiUpdateError = {
  '@type': 'error';
  error: ApiError;
};

export type ApiUpdateStorageLocked = {
  '@type': 'updateStorageLocked';
};

export type ApiUpdateNotSupportedInFrozenAccountError = {
  '@type': 'notSupportedInFrozenAccount';
  error: ApiError;
};

export type ApiUpdateConfig = {
  '@type': 'updateConfig';
};

export type ApiUpdateResetContacts = {
  '@type': 'updateResetContactList';
};

export type ApiUpdateRecentStickers = {
  '@type': 'updateRecentStickers';
};

export type ApiUpdateMoveStickerSetToTop = {
  '@type': 'updateMoveStickerSetToTop';
  isCustomEmoji?: boolean;
  id: string;
};

export type ApiUpdateStickerSets = {
  '@type': 'updateStickerSets';
};

export type ApiUpdateStickerSetsOrder = {
  '@type': 'updateStickerSetsOrder';
  order: string[];
  isCustomEmoji?: boolean;
};

export type ApiUpdateStickerSet = {
  '@type': 'updateStickerSet';
  id: string;
  stickerSet: Partial<ApiStickerSet>;
};

export type ApiUpdateDefaultNotifySettings = {
  '@type': 'updateDefaultNotifySettings';
  peerType: ApiNotifyPeerType;
  settings: Partial<ApiPeerNotifySettings>;
};

export type ApiUpdatePeerNotifySettings = {
  '@type': 'updateChatNotifySettings';
  chatId: string;
  settings: Partial<ApiPeerNotifySettings>;
};

export type ApiUpdatePeerBlocked = {
  '@type': 'updatePeerBlocked';
  id: string;
  isBlocked?: boolean;
  isBlockedFromStories?: boolean;
};

export type ApiUpdatePrivacy = {
  '@type': 'updatePrivacy';
  key: ApiPrivacyKey;
  rules: {
    visibility: PrivacyVisibility;
    allowUserIds: string[];
    allowChatIds: string[];
    blockUserIds: string[];
    blockChatIds: string[];
  };
};

export type ApiUpdateServerTimeOffset = {
  '@type': 'updateServerTimeOffset';
  serverTimeOffset: number;
};

export type ApiUpdateBackupSettings = {
  '@type': 'updateBackupSettings';
  settings: ApiBackupSettings;
};

export type ApiUpdatePendingJoinRequests = {
  '@type': 'updatePendingJoinRequests';
  chatId: string;
  recentRequesterIds: string[];
  requestsPending: number;
};

export type ApiRequestReconnectApi = {
  '@type': 'requestReconnectApi';
};

export type ApiUpdateStory = {
  '@type': 'updateStory';
  peerId: string;
  story: ApiStory | ApiStorySkipped;
};

// Signal: the notification profiles after a change, or the one that is on changed
export type ApiUpdateNotificationProfiles = {
  '@type': 'updateNotificationProfiles';
  state: ApiNotificationProfilesState;
};

// Signal: the call history after a change; the app replaces its list
export type ApiUpdateCallLog = {
  '@type': 'updateCallLog';
  entries: ApiCallLogEntry[];
};

export type ApiUpdateDeleteStory = {
  '@type': 'deleteStory';
  peerId: string;
  storyId: number;
};

export type ApiUpdateReadStories = {
  '@type': 'updateReadStories';
  peerId: string;
  lastReadId: number;
};

export type ApiUpdateSentStoryReaction = {
  '@type': 'updateSentStoryReaction';
  peerId: string;
  storyId: number;
  reaction?: ApiReaction;
};

export type ApiRequestSync = {
  '@type': 'requestSync';
};

export type ApiUpdateEntities = {
  '@type': 'updateEntities';
  users?: Record<string, ApiUser>;
  chats?: Record<string, ApiChat>;
  threadInfos?: ApiThreadInfo[];
  polls?: ApiMessagePoll[];
  webPages?: ApiWebPage[];
};

export type ApiUpdateWebPage = {
  '@type': 'updateWebPage';
  webPage: ApiWebPage;
};

export type ApiUpdate = (
  ApiUpdateReady | ApiUpdateSession | ApiUpdateRequestUserUpdate | ApiUpdateAuthorizationState |
  ApiUpdateAuthorizationError | ApiUpdateConnectionState | ApiUpdateDeviceDeauthorized | ApiUpdateStaleSession |
  ApiUpdateCurrentUser | ApiUpdateChat |
  ApiUpdateChatTypingStatus | ApiUpdateChatFullInfo | ApiUpdatePinnedChatIds | ApiUpdateChatMembers |
  ApiUpdateChatParticipantRank | ApiUpdateChatJoin | ApiUpdateChatLeave | ApiUpdateChatPinned |
  ApiUpdatePinnedMessageIds | ApiUpdateChatListType | ApiUpdateChatFolder | ApiUpdateChatFoldersOrder |
  ApiUpdateNewMessage | ApiUpdateMessage | ApiUpdateEphemeralMessage | ApiUpdateThreadInfo | ApiUpdateDeleteMessages |
  ApiUpdateMessagePoll | ApiUpdateDeleteHistory |
  ApiUpdateMessageSendSucceeded | ApiUpdateMessageSendFailed | ApiUpdateSafetyNumberBlock | ApiDeleteContact |
  ApiUpdateUser | ApiUpdateUserStatus | ApiUpdateUserFullInfo | ApiUpdatePeerSettings | ApiUpdatePeerHistoryTtl |
  ApiUpdateAvatar | ApiUpdateMessageImage | ApiUpdateDraftMessage | ApiUpdateScheduledMessageSendFailed |
  ApiUpdateError | ApiUpdateStorageLocked | ApiUpdateResetContacts | ApiUpdateThreadReadState | ApiUpdateStickerSet |
  ApiUpdateStickerSets |
  ApiUpdateStickerSetsOrder | ApiUpdateRecentStickers | ApiUpdateNewScheduledMessage | ApiUpdateMoveStickerSetToTop |
  ApiUpdateScheduledMessageSendSucceeded | ApiUpdateScheduledMessage | ApiUpdateDeleteScheduledMessages |
  ApiUpdateResetMessages | ApiUpdateWebPage | ApiUpdateDefaultNotifySettings | ApiUpdatePeerNotifySettings |
  ApiUpdatePeerBlocked | ApiUpdatePrivacy | ApiUpdateServerTimeOffset | ApiUpdateBackupSettings |
  ApiUpdatePendingJoinRequests | ApiUpdateConfig | ApiUpdateStory | ApiUpdateReadStories | ApiUpdateDeleteStory |
  ApiUpdateSentStoryReaction | ApiRequestReconnectApi | ApiRequestSync | ApiUpdateChatLastMessage | ApiUpdateEntities |
  ApiUpdateNotSupportedInFrozenAccountError |
  ApiUpdateCallLog | ApiUpdateNotificationProfiles
);

export type OnApiUpdate = (update: ApiUpdate) => void;
