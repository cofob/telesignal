/*
 * The Signal provider that Web A and Web K share: `../../../../src/api/signal` (Web A's tree) over the engine in
 * `../../../../src/lib/signal`. Vite resolves `@signal-app/provider` to `src/api/signal/methods/init.ts`; for this
 * tree's type check it resolves to this file, which describes the part of the provider's API that Web K uses. The
 * provider's own sources are type-checked by the repository's `npm run check:ts`, with its stricter settings.
 *
 * The shapes follow `src/api/types` of Web A; only the fields that Web K reads are listed. The repository's
 * `npm run check:ts` checks them, and the method names, against the provider (`src/api/signal/webkContract.ts`).
 */

export type SignalEntity = {
  type: string,
  offset: number,
  length: number,
  url?: string,
  userId?: string,
  language?: string
};

export type SignalFormattedText = {
  text: string,
  entities?: SignalEntity[]
};

export type SignalUser = {
  id: string,
  isSelf?: true,
  isContact?: true,
  type: string,
  firstName?: string,
  lastName?: string,
  phoneNumber: string,
  usernames?: {username: string, isActive?: boolean}[],
  avatarPhotoId?: string,
  color?: {color?: number},
  areStoriesHidden?: boolean
};

/** The rights of `ApiChatAdminRights` that Web K maps to Telegram's flags */
export type SignalAdminRights = {
  changeInfo?: true,
  postMessages?: true,
  editMessages?: true,
  deleteMessages?: true,
  banUsers?: true,
  inviteUsers?: true,
  pinMessages?: true,
  addAdmins?: true,
  manageRanks?: true
};

/** The rights of `ApiChatBannedRights` that Web K maps to Telegram's flags */
export type SignalBannedRights = {
  viewMessages?: true,
  sendMessages?: true,
  sendMedia?: true,
  sendStickers?: true,
  sendGifs?: true,
  sendGames?: true,
  sendInline?: true,
  embedLinks?: true,
  sendPolls?: true,
  changeInfo?: true,
  inviteUsers?: true,
  pinMessages?: true,
  editRank?: true
};

/** The chat colour and wallpaper of a chat, as CSS backgrounds (`ApiSignalChatStyle`) */
export type SignalChatStyle = {bubbleColor?: string, wallpaper?: string};

/** Someone invited to a group who has not accepted yet (`ApiChatPendingInvite`), with Web K's peer ids */
export type SignalPendingInvite = {serviceId: string, userId?: PeerId, phoneNumber?: string, inviterId?: PeerId};

export type SignalChat = {
  id: string,
  folderId?: number,
  type: 'chatTypePrivate' | 'chatTypeSecret' | 'chatTypeBasicGroup' | 'chatTypeSuperGroup' | 'chatTypeChannel',
  title: string,
  avatarPhotoId?: string,
  membersCount?: number,
  creationDate?: number,
  isListed?: boolean,
  isNotJoined?: boolean,
  isForbidden?: boolean,
  isOwner?: boolean,
  adminRights?: SignalAdminRights,
  defaultBannedRights?: SignalBannedRights,
  ttlPeriod?: number,
  areStoriesHidden?: boolean,
  color?: {color?: number}
};

/** An action of the provider (`ApiMessageAction`): Web K reads its other fields by its `type` */
export type SignalMessageAction = {
  mediaType: 'action',
  type: string,
  [key: string]: unknown
};

export type SignalReaction = {type: 'emoji', emoticon: string} | {type: 'custom', documentId: string};

export type SignalReactions = {
  canSeeList?: boolean,
  results: {chosenOrder?: number, count: number, reaction: SignalReaction}[],
  recentReactions?: {peerId: string, reaction: SignalReaction, isOwn?: boolean, addedDate: number}[]
};

export type SignalThumbnail = {dataUri: string, width: number, height: number};

export type SignalPhoto = {
  mediaType: 'photo',
  id: string,
  date: number,
  thumbnail?: SignalThumbnail,
  sizes: {type: string, width: number, height: number}[],
  size?: number,
  isUnavailable?: true
};

export type SignalVideo = {
  mediaType: 'video',
  id: string,
  mimeType: string,
  duration: number,
  fileName: string,
  width?: number,
  height?: number,
  isGif?: boolean,
  thumbnail?: SignalThumbnail,
  size: number,
  isUnavailable?: true
};

export type SignalDocument = {
  mediaType: 'document',
  id?: string,
  fileName: string,
  size: number,
  timestamp?: number,
  mimeType: string,
  thumbnail?: SignalThumbnail,
  isUnavailable?: true
};

export type SignalAudio = {
  mediaType: 'audio',
  id: string,
  size: number,
  mimeType: string,
  fileName: string,
  duration: number,
  performer?: string,
  title?: string,
  isUnavailable?: true
};

export type SignalVoice = {
  mediaType: 'voice',
  id: string,
  duration: number,
  waveform?: number[],
  size: number,
  isUnavailable?: true
};

export type SignalSticker = {
  mediaType: 'sticker',
  id: string,
  stickerSetInfo: {id: string, accessHash: string} | {shortName: string} | {isMissing: true},
  emoji?: string,
  isLottie: boolean,
  isVideo: boolean,
  width?: number,
  height?: number,
  size?: number,
  isUnavailable?: true
};

export type SignalAlbumItem = {photo?: SignalPhoto, video?: SignalVideo};

/** A file of a message the app sends, which the provider uploads (the provider's `ApiAttachment`) */
export type SignalAttachment = {
  blobUrl: string,
  filename: string,
  mimeType: string,
  size: number,
  quick?: {width: number, height: number, duration?: number},
  voice?: {duration: number, waveform: number[]},
  audio?: {duration: number, title?: string, performer?: string},
  shouldSendAsFile?: true,
  shouldSendAsGif?: true,
  uniqueId: string
};

export type SignalStickerSet = {
  id: string,
  accessHash: string,
  title: string,
  shortName: string,
  count: number,
  installedDate?: number,
  covers?: SignalSticker[],
  stickers?: SignalSticker[],
  packs?: Record<string, SignalSticker[]>
};

export type SignalContact = {
  mediaType: 'contact',
  firstName: string,
  lastName: string,
  phoneNumber: string,
  userId: string,
  vcard?: string
};

/** A link preview of a message, sent with the message as an `updateEntities` of `webPages` */
export type SignalWebPage = {
  mediaType: 'webpage',
  webpageType: 'full' | 'pending' | 'empty',
  id: string,
  url: string,
  hash: number,
  displayUrl: string,
  siteName?: string,
  title?: string,
  description?: string,
  photo?: SignalPhoto
};

export type SignalMessage = {
  id: number,
  chatId: string,
  date: number,
  isOutgoing: boolean,
  senderId?: string,
  content: {
    text?: SignalFormattedText,
    action?: SignalMessageAction,
    photo?: SignalPhoto,
    video?: SignalVideo,
    document?: SignalDocument,
    sticker?: SignalSticker,
    voice?: SignalVoice,
    audio?: SignalAudio,
    contact?: SignalContact,
    // Several photos and videos of one message, each item one of them
    album?: {mediaType: 'album', items: SignalAlbumItem[]},
    webPage?: {id: string},
    pollId?: string
  },
  // A reply to a story or an ephemeral reply has nothing that Web K shows
  replyInfo?: {
    type: 'message',
    replyToMsgId?: number,
    replyFrom?: {date: number, fromId?: string},
    quoteText?: SignalFormattedText,
    isQuote?: true
  } | {type: 'story' | 'ephemeral'},
  reactions?: SignalReactions,
  sendingState?: 'messageSendingStatePending' | 'messageSendingStateFailed',
  isPartiallySent?: true,
  isDelivered?: true,
  isEdited?: boolean,
  editDate?: number,
  isPinned?: boolean,
  isMentioned?: boolean,
  hasUnreadMention?: boolean,
  ttlPeriod?: number,
  groupedId?: string
};

export type SignalReadState = {
  unreadCount?: number,
  hasUnreadMark?: boolean,
  lastReadOutboxMessageId?: number,
  lastReadInboxMessageId?: number
};

export type SignalNotifySettings = {
  mutedUntil?: number,
  shouldShowPreviews?: boolean,
  isSilentPosting?: boolean
};

export type SignalChats = {
  chatIds: string[],
  chats: SignalChat[],
  users: SignalUser[],
  threadReadStatesById: Record<string, SignalReadState>,
  orderedPinnedIds?: string[],
  totalChatCount: number,
  messages: SignalMessage[],
  notifyExceptionById: Record<string, SignalNotifySettings>,
  lastMessageByChatId: Record<string, number>,
  nextOffsetDate?: number,
  isFullyLoaded?: true
};

export type SignalApiUpdate = {'@type': string, [key: string]: any};

export type SignalInitialArgs = {
  userAgent: string,
  platform?: string,
  langCode: string,
  signalProxyUrl?: string,
  signalSealedSenderProxyUrl?: string,
  /** the key of the engine's stores, when the account has a passcode (`@lib/signal/passcode`) */
  storageKey?: ArrayBuffer
};

/**
 * The methods of `src/api/signal/methods/index.ts` that Web K calls: `src/api/signal/webkContract.ts` checks that the
 * provider has each of them
 */
export type SignalMethodName =
  | 'addChatMemberByPhoneNumber'
  | 'addChatMembers'
  | 'backUpNow'
  | 'blockUser'
  | 'cancelBackup'
  | 'checkChatInvite'
  | 'checkKeyTransparencySelf'
  | 'clearCallLog'
  | 'clearRecentStickers'
  | 'closePoll'
  | 'confirmRecoveryKeySaved'
  | 'confirmUsername'
  | 'createGroupChat'
  | 'deleteChatUser'
  | 'deleteHistory'
  | 'deleteMessages'
  | 'deleteNotificationProfile'
  | 'deleteStory'
  | 'deleteStoryDistributionList'
  | 'deleteUsername'
  | 'destroy'
  | 'disableBackups'
  | 'disableChatInvite'
  | 'downloadMedia'
  | 'editChatParticipantRank'
  | 'editChatPhoto'
  | 'editExportedChatInvite'
  | 'editMessage'
  | 'enableBackups'
  | 'exportBackupFile'
  | 'exportChatInvite'
  | 'fetchAllStories'
  | 'fetchBackupRemoteStatus'
  | 'fetchBackupSettings'
  | 'fetchBlockedUsers'
  | 'fetchCallLog'
  | 'fetchChatInviteImporters'
  | 'fetchChats'
  | 'fetchCommonChats'
  | 'fetchContactList'
  | 'fetchDeauthorizationReason'
  | 'fetchDefaultHistoryTtl'
  | 'fetchExportedChatInvites'
  | 'fetchFeaturedStickers'
  | 'fetchFullChat'
  | 'fetchFullUser'
  | 'fetchIsSignalPrimary'
  | 'fetchKeyTransparencySelfStatus'
  | 'fetchMessageReactionsList'
  | 'fetchMessageSendDetails'
  | 'fetchMessages'
  | 'fetchMessagesById'
  | 'fetchNearestCountry'
  | 'fetchNotificationProfiles'
  | 'fetchNotifyDefaultSettings'
  | 'fetchPeerColors'
  | 'fetchPeerSettings'
  | 'fetchPeerStories'
  | 'fetchPeerStoriesByIds'
  | 'fetchPhoneNumberPrivacy'
  | 'fetchPinnedMessages'
  | 'fetchRecentStickers'
  | 'fetchRecoveryKey'
  | 'fetchSafetyNumber'
  | 'fetchSharedMediaCounts'
  | 'fetchSignalContactDiscovery'
  | 'fetchSignalDevices'
  | 'fetchSignalMessageSettings'
  | 'fetchSignalPinSettings'
  | 'fetchStickerSets'
  | 'fetchStickers'
  | 'fetchStoriesViews'
  | 'fetchStoryDistributionLists'
  | 'fetchStorySettings'
  | 'fetchStoryViewList'
  | 'fetchUnreadMentions'
  | 'fetchUsernameLink'
  | 'fetchUsers'
  | 'forwardMessages'
  | 'getChatByUsername'
  | 'hideAllChatJoinRequests'
  | 'hideChatJoinRequest'
  | 'hidePeerSettingsBar'
  | 'importBackupFile'
  | 'importChatInvite'
  | 'installStickerSet'
  | 'linkSignalDevice'
  | 'loadPollOptionResults'
  | 'lookUpPhoneNumber'
  | 'markCallLogSeen'
  | 'markMessageListRead'
  | 'markMessagesRead'
  | 'markStoryRead'
  | 'pinMessage'
  | 'provideAuthCaptcha'
  | 'provideAuthCode'
  | 'provideAuthPassword'
  | 'provideAuthPhoneNumber'
  | 'provideAuthRegistration'
  | 'provideAuthRestore'
  | 'removeRecentSticker'
  | 'removeSignalPin'
  | 'reportSpam'
  | 'requestAuthCode'
  | 'reserveUsername'
  | 'resetUsernameLink'
  | 'resolveUsernameLink'
  | 'restartAuth'
  | 'restartAuthWithQr'
  | 'saveNotificationProfile'
  | 'saveStoryDistributionList'
  | 'searchChats'
  | 'searchMessagesGlobal'
  | 'searchMessagesInChat'
  | 'sendMessage'
  | 'sendMessageAction'
  | 'sendPollVote'
  | 'sendReaction'
  | 'sendStory'
  | 'sendStoryReaction'
  | 'setBackupFrequency'
  | 'setDefaultHistoryTtl'
  | 'setHistoryTtl'
  | 'setNotificationProfileActive'
  | 'setSignalContactDiscovery'
  | 'setSignalPin'
  | 'setSignalRegistrationLock'
  | 'resendMessage'
  | 'revokeChatInvite'
  | 'sendMessageAnyway'
  | 'skipAuthRestore'
  | 'terminateChat'
  | 'toggleChatArchived'
  | 'toggleChatPinned'
  | 'toggleDialogUnread'
  | 'toggleStoriesHidden'
  | 'unblockUser'
  | 'uninstallStickerSet'
  | 'unlinkSignalDevice'
  | 'unpinAllMessages'
  | 'updateChatAbout'
  | 'updateChatAdmin'
  | 'updateChatDefaultBannedRights'
  | 'updateChatNotifySettings'
  | 'updateChatTitle'
  | 'updateNotificationSettings'
  | 'updateOwnProfile'
  | 'updatePhoneNumberPrivacy'
  | 'updateSafetyNumberVerified'
  | 'updateSignalMessageSettings'
  | 'updateStorySettings';

export function initApi(onUpdate: (update: SignalApiUpdate) => void, initialArgs: SignalInitialArgs): Promise<void>;

/** A method of `src/api/signal/methods/index.ts`; one the provider lacks returns `undefined` */
export function callApi(name: SignalMethodName, ...args: any[]): any;
