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

export type SignalMessage = {
  id: number,
  chatId: string,
  date: number,
  isOutgoing: boolean,
  senderId?: string,
  content: {
    text?: SignalFormattedText,
    action?: SignalMessageAction,
    photo?: unknown,
    video?: unknown,
    document?: unknown,
    sticker?: unknown,
    voice?: unknown,
    audio?: unknown,
    contact?: unknown,
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
  signalSealedSenderProxyUrl?: string
};

export function initApi(onUpdate: (update: SignalApiUpdate) => void, initialArgs: SignalInitialArgs): Promise<void>;

/** A method of `src/api/signal/methods/index.ts`; one the provider lacks returns `undefined` */
export function callApi(name: string, ...args: any[]): any;
