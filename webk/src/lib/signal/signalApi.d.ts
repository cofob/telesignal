/*
 * The Signal provider that Web A and Web K share: `../../../../src/api/signal` (Web A's tree) over the engine in
 * `../../../../src/lib/signal`. Vite resolves `@signal-app/provider` to `src/api/signal/methods/init.ts`; for this
 * tree's type check it resolves to this file, which describes the part of the provider's API that Web K uses. The
 * provider's own sources are type-checked by the repository's `npm run check:ts`, with its stricter settings.
 *
 * The shapes follow `src/api/types` of Web A; only the fields that Web K reads are listed.
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
  color?: {color?: number}
};

/** The rights of `ApiChatAdminRights` and `ApiChatBannedRights`: the provider's flag names set to `true` */
export type SignalRights = Record<string, true | undefined>;

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
  adminRights?: SignalRights,
  defaultBannedRights?: SignalRights,
  ttlPeriod?: number
};

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
  isGif?: true,
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
  replyInfo?: {
    type: 'message',
    replyToMsgId?: number,
    replyFrom?: {date: number, fromId: string},
    quoteText?: SignalFormattedText,
    isQuote?: true
  },
  reactions?: SignalReactions,
  sendingState?: 'messageSendingStatePending' | 'messageSendingStateFailed',
  isDelivered?: true,
  isEdited?: boolean,
  editDate?: number,
  isPinned?: boolean,
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

export function initApi(onUpdate: (update: SignalApiUpdate) => void, initialArgs: SignalInitialArgs): Promise<void>;

/** A method of `src/api/signal/methods/index.ts`; one the provider lacks returns `undefined` */
export function callApi(name: string, ...args: any[]): any;
