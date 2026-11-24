import type { SendErrorKind } from '../../lib/signal/db/MessageDb';
import type { ThreadId, WebPageMediaSize } from '../../types';
import type { MediaEditDocument } from '../../types/mediaEditor';
import type { ApiRichText } from './instantView';
import type { ApiMessageAction } from './messageActions';
import type { ApiAttachment, ApiRestrictionReason } from './misc';
import type { ApiRichMessage } from './richMessage';
import type {
  ApiMessageStoryData, ApiStory, ApiWebPageStickerData, ApiWebPageStoryData,
} from './stories';
import type { ApiInlineQueryPeerType } from './users';

export interface ApiDimensions {
  width: number;
  height: number;
}

export interface ApiPhotoSize extends ApiDimensions {
  type: 's' | 'm' | 'x' | 'y' | 'w';
}

export interface ApiVideoSize extends ApiDimensions {
  type: 'u' | 'v';
  videoStartTs?: number;
  size: number;
}

export interface ApiThumbnail extends ApiDimensions {
  dataUri: string;
}

export interface ApiWebDocument {
  mediaType: 'webDocument';
  url: string;
  size: number;
  mimeType: string;
  accessHash?: string;
  dimensions?: ApiDimensions;
}

export interface ApiPhoto {
  mediaType: 'photo';
  id: string;
  date: number;
  thumbnail?: ApiThumbnail;
  isVideo?: boolean;
  sizes: ApiPhotoSize[];
  videoSizes?: ApiVideoSize[];
  blobUrl?: string;
  isSpoiler?: boolean;
  // Signal: the size of the image in bytes, which a download needs
  size?: number;
  // Signal: the CDN no longer has the file
  isUnavailable?: true;
}

export interface ApiSticker {
  mediaType: 'sticker';
  id: string;
  stickerSetInfo: ApiStickerSetInfo;
  emoji?: string;
  isCustomEmoji?: boolean;
  isLottie: boolean;
  isVideo: boolean;
  width?: number;
  height?: number;
  thumbnail?: ApiThumbnail;
  previewPhotoSizes?: ApiPhotoSize[];
  hasEffect?: boolean;
  isFree?: boolean;
  shouldUseTextColor?: boolean;
  // Signal: the size of the sticker in bytes, which a download needs
  size?: number;
  // Signal: the CDN no longer has the file
  isUnavailable?: true;
}

export interface ApiStickerSet {
  isArchived?: true;
  isEmoji?: true;
  installedDate?: number;
  id: string;
  accessHash: string;
  title: string;
  hasThumbnail?: boolean;
  hasStaticThumb?: boolean;
  hasAnimatedThumb?: boolean;
  hasVideoThumb?: boolean;
  thumbnail?: ApiThumbnail;
  thumbCustomEmojiId?: string;
  count: number;
  stickers?: ApiSticker[];
  packs?: Record<string, ApiSticker[]>;
  covers?: ApiSticker[];
  shortName: string;
}

type ApiStickerSetInfoShortName = {
  shortName: string;
};

type ApiStickerSetInfoId = {
  id: string;
  accessHash: string;
};

type ApiStickerSetInfoMissing = {
  isMissing: true;
};

export type ApiStickerSetInfo = ApiStickerSetInfoShortName | ApiStickerSetInfoId | ApiStickerSetInfoMissing;

export interface StoryboardInfo {
  storyboardFile: ApiDocument;
  storyboardMapFile: ApiDocument;
  frameSize: ApiDimensions;
}

export interface ApiVideo {
  mediaType: 'video';
  id: string;
  mimeType: string;
  duration: number;
  fileName: string;
  width?: number;
  height?: number;
  supportsStreaming?: boolean;
  isRound?: boolean;
  isGif?: boolean;
  hasVideoPreview?: boolean;
  isSpoiler?: boolean;
  thumbnail?: ApiThumbnail;
  previewPhotoSizes?: ApiPhotoSize[];
  blobUrl?: string;
  previewBlobUrl?: string;
  editPreview?: {
    blobUrl: string;
    mimeType: string;
    document: MediaEditDocument;
  };
  size: number;
  noSound?: boolean;
  waveform?: number[];
  timestamp?: number;
  altVideos?: ApiVideo[];
  storyboardInfo?: StoryboardInfo;
  cover?: ApiPhoto;
  // Signal: the CDN no longer has the file
  isUnavailable?: true;
}

export interface ApiAudio {
  mediaType: 'audio';
  id: string;
  size: number;
  mimeType: string;
  fileName: string;
  duration: number;
  performer?: string;
  title?: string;
  thumbnailSizes?: ApiPhotoSize[];
  // Signal: the CDN no longer has the file
  isUnavailable?: true;
}

export interface ApiVoice {
  mediaType: 'voice';
  id: string;
  duration: number;
  waveform?: number[];
  size: number;
  // Signal: the CDN no longer has the file
  isUnavailable?: true;
}

export interface ApiDocument {
  mediaType: 'document';
  id?: string;
  fileName: string;
  size: number;
  timestamp?: number;
  mimeType: string;
  thumbnail?: ApiThumbnail;
  previewPhotoSizes?: ApiPhotoSize[];
  previewBlobUrl?: string;
  innerMediaType?: 'photo' | 'video';
  mediaSize?: ApiDimensions & { fromDocumentAttribute?: boolean; fromPreload?: true };
  // Signal: the CDN no longer has the file
  isUnavailable?: true;
}

export interface ApiContact {
  mediaType: 'contact';
  firstName: string;
  lastName: string;
  phoneNumber: string;
  userId: string;
  // Signal: the shared contact as a vCard, which the message offers to save
  vcard?: string;
  // Signal: the contact's ACI when no chat with it exists yet; messaging it creates one
  aci?: string;
}

export interface ApiPollAnswer {
  text: ApiFormattedText;
  option: string;
  media?: MediaContent;
  addedByPeerId?: string;
  date?: number;
}

export interface ApiPollResult {
  isChosen?: true;
  option: string;
  votersCount: number;
  recentVoterIds?: string[];
}

export interface ApiPoll {
  id: string;
  hash: string;
  isClosed?: true;
  isPublic?: true;
  isMultipleChoice?: true;
  canAddAnswers?: true;
  isRevoteDisabled?: true;
  shouldShuffleAnswers?: true;
  shouldHideResultsUntilClose?: true;
  isCreator?: true;
  isRestrictedToSubscribers?: true;
  allowedCountryCodes?: string[];
  question: ApiFormattedText;
  answers: ApiPollAnswer[];
  closePeriod?: number;
  closeDate?: number;
}

export interface ApiPollResults {
  isMin?: true;
  resultByOption?: Record<string, ApiPollResult>;
  totalVoters?: number;
  recentVoterIds?: string[];
}

export interface ApiMessagePoll {
  mediaType: 'poll';
  summary: ApiPoll;
  results: ApiPollResults;
  attachedMedia?: MediaContent;
}

export type ApiDice = {
  mediaType: 'dice';
  value: number;
  emoticon: string;
};

export type ApiNewPoll = {
  summary: ApiPoll;
  attachedMedia?: ApiAttachment;
};

export interface ApiWebPagePending {
  mediaType: 'webpage';
  webpageType: 'pending';
  id: string;
  url?: string;
  isSafe?: true;
}

export interface ApiWebPageEmpty {
  mediaType: 'webpage';
  webpageType: 'empty';
  id: string;
  url?: string;
  isSafe?: true;
}

export interface ApiWebPageFull {
  mediaType: 'webpage';
  webpageType: 'full';
  id: string;
  url: string;
  hash: number;
  displayUrl: string;
  type?: string;
  siteName?: string;
  title?: string;
  description?: string;
  photo?: ApiPhoto;
  audio?: ApiAudio;
  duration?: number;
  document?: ApiDocument;
  video?: ApiVideo;
  story?: ApiWebPageStoryData;
  stickers?: ApiWebPageStickerData;
  hasLargeMedia?: boolean;
}

export type ApiWebPage = ApiWebPagePending | ApiWebPageEmpty | ApiWebPageFull;

/**
 * Wrapper with message-specific fields
 */
export interface ApiMessageWebPage {
  id: string;
  isSafe?: true;
  mediaSize?: WebPageMediaSize;
}

export type ApiReplyInfo = ApiMessageReplyInfo | ApiEphemeralReplyInfo | ApiStoryReplyInfo;

export interface ApiMessageReplyInfo {
  type: 'message';
  replyToMsgId?: number;
  replyToPeerId?: string;
  replyFrom?: ApiMessageForwardInfo;
  replyMedia?: MediaContent;
  replyToTopId?: number;
  isQuote?: true;
  pollOption?: string;
  replyOptionText?: ApiFormattedText;
  quoteText?: ApiFormattedText;
  quoteRich?: ApiRichText[];
  quoteOffset?: number;
}

export interface ApiEphemeralReplyInfo {
  type: 'ephemeral';
  replyToMsgId: number;
}

export interface ApiStoryReplyInfo {
  type: 'story';
  peerId: string;
  storyId: number;
}

export interface ApiInputMessageReplyInfo {
  type: 'message';
  replyToMsgId: number;
  replyToTopId?: number;
  replyToPeerId?: string;
  monoforumPeerId?: string;
  quoteText?: ApiFormattedText;
  quoteRich?: ApiRichText[];
  quoteOffset?: number;
  pollOption?: string;
}

export interface ApiInputEphemeralReplyInfo {
  type: 'ephemeral';
  replyToMsgId: number;
}

export interface ApiInputStoryReplyInfo {
  type: 'story';
  peerId: string;
  storyId: number;
}

export type ApiInputDraftReplyInfo = ApiInputMessageReplyInfo | ApiInputEphemeralReplyInfo;
export type ApiInputReplyInfo = ApiInputDraftReplyInfo | ApiInputStoryReplyInfo;

export interface ApiMessageForwardInfo {
  date: number;
  savedDate?: number;
  isImported?: boolean;
  isChannelPost: boolean;
  channelPostId?: number;
  isLinkedChannelPost?: boolean;
  fromChatId?: string;
  fromId?: string;
  savedFromPeerId?: string;
  isSavedOutgoing?: boolean;
  fromMessageId?: number;
  hiddenUserName?: string;
  postAuthorTitle?: string;
}

export interface ApiStoryForwardInfo {
  fromPeerId?: string;
  fromName?: string;
  storyId?: number;
  isModified?: boolean;
}

export type ApiMessageEntityDefault = {
  type: Exclude<
  `${ApiMessageEntityTypes}`,
  `${ApiMessageEntityTypes.Pre}` | `${ApiMessageEntityTypes.TextUrl}` | `${ApiMessageEntityTypes.MentionName}` |
  `${ApiMessageEntityTypes.Blockquote}` | `${ApiMessageEntityTypes.CustomEmoji}` |
  `${ApiMessageEntityTypes.Timestamp}` | `${ApiMessageEntityTypes.FormattedDate}` |
  `${ApiMessageEntityTypes.DiffInsert}` | `${ApiMessageEntityTypes.DiffReplace}` | `${ApiMessageEntityTypes.DiffDelete}`
  >;
  offset: number;
  length: number;
};

export type ApiMessageEntityPre = {
  type: ApiMessageEntityTypes.Pre;
  offset: number;
  length: number;
  language?: string;
};

export type ApiMessageEntityTextUrl = {
  type: ApiMessageEntityTypes.TextUrl;
  offset: number;
  length: number;
  url: string;
};

export type ApiMessageEntityMentionName = {
  type: ApiMessageEntityTypes.MentionName;
  offset: number;
  length: number;
  userId: string;
};

export type ApiMessageEntityBlockquote = {
  type: ApiMessageEntityTypes.Blockquote;
  offset: number;
  length: number;
  canCollapse?: boolean;
};

export type ApiMessageEntityCustomEmoji = {
  type: ApiMessageEntityTypes.CustomEmoji;
  offset: number;
  length: number;
  documentId: string;
};

export type ApiMessageEntityFormattedDate = {
  type: ApiMessageEntityTypes.FormattedDate;
  offset: number;
  length: number;
  date: number;
  relative?: true;
  shortTime?: true;
  longTime?: true;
  shortDate?: true;
  longDate?: true;
  dayOfWeek?: true;
};

// Local entities
export type ApiMessageEntityTimestamp = {
  type: ApiMessageEntityTypes.Timestamp;
  offset: number;
  length: number;
  timestamp: number;
};

export type ApiMessageEntityDiffInsert = {
  type: ApiMessageEntityTypes.DiffInsert;
  offset: number;
  length: number;
};

export type ApiMessageEntityDiffReplace = {
  type: ApiMessageEntityTypes.DiffReplace;
  offset: number;
  length: number;
  oldText: string;
};

export type ApiMessageEntityDiffDelete = {
  type: ApiMessageEntityTypes.DiffDelete;
  offset: number;
  length: number;
};

export type ApiMessageEntity = ApiMessageEntityDefault | ApiMessageEntityPre | ApiMessageEntityTextUrl |
  ApiMessageEntityMentionName | ApiMessageEntityCustomEmoji | ApiMessageEntityBlockquote | ApiMessageEntityTimestamp |
  ApiMessageEntityFormattedDate | ApiMessageEntityDiffInsert | ApiMessageEntityDiffReplace | ApiMessageEntityDiffDelete;

export enum ApiMessageEntityTypes {
  Bold = 'MessageEntityBold',
  Blockquote = 'MessageEntityBlockquote',
  BotCommand = 'MessageEntityBotCommand',
  Cashtag = 'MessageEntityCashtag',
  Code = 'MessageEntityCode',
  Email = 'MessageEntityEmail',
  Hashtag = 'MessageEntityHashtag',
  Italic = 'MessageEntityItalic',
  MentionName = 'MessageEntityMentionName',
  Mention = 'MessageEntityMention',
  Phone = 'MessageEntityPhone',
  Pre = 'MessageEntityPre',
  Strike = 'MessageEntityStrike',
  TextUrl = 'MessageEntityTextUrl',
  Url = 'MessageEntityUrl',
  Underline = 'MessageEntityUnderline',
  Spoiler = 'MessageEntitySpoiler',
  CustomEmoji = 'MessageEntityCustomEmoji',
  Timestamp = 'MessageEntityTimestamp',
  FormattedDate = 'MessageEntityFormattedDate',
  Unknown = 'MessageEntityUnknown',
  DiffInsert = 'MessageEntityDiffInsert',
  DiffReplace = 'MessageEntityDiffReplace',
  DiffDelete = 'MessageEntityDiffDelete',
}

export interface ApiFormattedText {
  text: string;
  entities?: ApiMessageEntity[];
}

export interface ApiFormattedTextWithEmojiOnlyCount extends ApiFormattedText {
  emojiOnlyCount?: number;
}

/**
 * Signal: the photos and videos of one message, which it shows as an album. The message's `photo` or `video` is the
 * first of them.
 */
export interface ApiMessageAlbum {
  mediaType: 'album';
  items: Pick<MediaContent, 'photo' | 'video'>[];
}

export type MediaContent = {
  text?: ApiFormattedTextWithEmojiOnlyCount;
  richMessage?: ApiRichMessage;
  photo?: ApiPhoto;
  video?: ApiVideo;
  album?: ApiMessageAlbum;
  document?: ApiDocument;
  sticker?: ApiSticker;
  contact?: ApiContact;
  pollId?: string;
  action?: ApiMessageAction;
  webPage?: ApiMessageWebPage;
  audio?: ApiAudio;
  voice?: ApiVoice;
  storyData?: ApiMessageStoryData;
  dice?: ApiDice;
  ttlSeconds?: number;
};
export type MediaContainer = {
  content: MediaContent;
};

export type StatefulMediaContent = {
  poll?: ApiMessagePoll;
  story?: ApiStory;
  webPage?: ApiWebPage;
};

export type SizeTarget =
  'micro'
  | 'pictogram'
  | 'inline'
  | 'preview'
  | 'full'
  | 'download';

export interface ApiMessage {
  id: number;
  ephemeralBotId?: string;
  ephemeralId?: number;
  ephemeralReceiverId?: string;
  anchorMsgId?: number;
  ephemeralRandomId?: string;
  ephemeralTopMsgId?: number;
  isEphemeral?: true;
  chatId: string;
  content: MediaContent;
  date: number;
  isOutgoing: boolean;
  ttlPeriod?: number;
  senderId?: string;
  replyInfo?: ApiReplyInfo;
  sendingState?: 'messageSendingStatePending' | 'messageSendingStateFailed';
  // Signal: a recipient's device received the message
  isDelivered?: true;
  // Signal: some recipients got the message and sending it to others failed
  isPartiallySent?: true;
  // Signal: the reason a local message failed to be sent, which has no recipients to tell it by
  sendError?: ApiLocalSendError;
  forwardInfo?: ApiMessageForwardInfo;
  isDeleting?: boolean;
  previousLocalId?: number;
  viewsCount?: number;
  forwardsCount?: number;
  isEdited?: boolean;
  editDate?: number;
  isMentioned?: boolean;
  isMediaUnread?: boolean;
  groupedId?: string;
  isInAlbum?: boolean;
  hasUnreadMention?: boolean;
  postAuthorTitle?: string;
  isScheduled?: boolean;
  isFromScheduled?: boolean;
  isSilent?: boolean;
  isPinned?: boolean;
  seenByDates?: Record<string, number>;
  isProtected?: boolean;
  isForwardingAllowed?: boolean;
  reactors?: {
    nextOffset?: string;
    count: number;
    reactions: ApiPeerReaction[];
  };
  reactions?: ApiReactions;
  hasComments?: boolean;
  readDate?: number;
  savedPeerId?: string;
  factCheck?: ApiFactCheck;
  isInvertedMedia?: true;
  isVideoProcessingPending?: true;
  areReactionsPossible?: true;
  reportDeliveryUntilDate?: number;
  restrictionReasons?: ApiRestrictionReason[];
  fromRank?: string;

  isTypingDraft?: boolean; // Local field
  typingDraft?: {
    canStop?: true;
    shouldKeepOnStop?: true;
  }; // Local field
  shouldSkipTypingAnimation?: true; // Local field
  wasTypingDraft?: boolean; // Local field
}

export interface ApiReactions {
  canSeeList?: boolean;
  results: ApiReactionCount[];
  recentReactions?: ApiPeerReaction[];
  topReactors?: ApiMessageReactor[];
}

export interface ApiPeerReaction {
  peerId: string;
  reaction: ApiReaction;
  isOwn?: boolean;
  isBig?: boolean;
  isUnread?: boolean;
  addedDate: number;
}

export interface ApiMessageReactor {
  isTop?: true;
  isMy?: true;
  count: number;
  isAnonymous?: true;
  peerId?: string;
}

export interface ApiReactionCount {
  chosenOrder?: number;
  count: number;
  reaction: ApiReaction;
}

export interface ApiAvailableReaction {
  selectAnimation?: ApiDocument;
  appearAnimation?: ApiDocument;
  activateAnimation?: ApiDocument;
  effectAnimation?: ApiDocument;
  staticIcon?: ApiDocument;
  centerIcon?: ApiDocument;
  aroundAnimation?: ApiDocument;
  reaction: ApiReactionEmoji;
  title: string;
  isInactive?: boolean;
  isLocalCache?: true;
}

type ApiChatReactionsAll = {
  type: 'all';
  areCustomAllowed?: true;
};

type ApiChatReactionsSome = {
  type: 'some';
  allowed: ApiReaction[];
};

export type ApiChatReactions = ApiChatReactionsAll | ApiChatReactionsSome;

export type ApiReactionEmoji = {
  type: 'emoji';
  emoticon: string;
};

export type ApiReactionCustomEmoji = {
  type: 'custom';
  documentId: string;
};

export type ApiReaction = ApiReactionEmoji | ApiReactionCustomEmoji;

export type ApiReactionKey = `${string}-${string}` | 'unsupported';

export interface ApiBaseThreadInfo {
  chatId: string;
  messagesCount?: number;
  lastMessageId?: number;
  recentReplierIds?: string[];
}

export interface ApiCommentsInfo extends ApiBaseThreadInfo {
  isCommentsInfo: true;
  threadId?: never;
  originChannelId: string;
  originMessageId: number;
  hasUnread?: boolean;
}

export interface ApiMessageThreadInfo extends ApiBaseThreadInfo {
  isCommentsInfo: false;
  threadId: ThreadId;
  // For linked messages in discussion
  fromChannelId?: string;
  fromMessageId?: number;
}

export type ApiThreadInfo = ApiCommentsInfo | ApiMessageThreadInfo;

export type ApiMessageReportResult = {
  type: 'reported';
} | {
  type: 'comment';
  isOptional?: boolean;
  option: string;
} | {
  type: 'selectOption';
  title: string;
  options: {
    text: string;
    option: string;
  }[];
};

export type ApiMessageOutgoingStatus = 'read' | 'delivered' | 'succeeded' | 'pending' | 'failed' | 'partial';

export type ApiSendErrorKind = SendErrorKind;

// Signal: why a message that was not stored failed; `upload` is an attachment that could not be uploaded
export type ApiLocalSendError = ApiSendErrorKind | 'upload';

/** Signal: how sending an outgoing message to one recipient went, and for a failure, why */
export type ApiMessageRecipient = {
  userId: string;
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'viewed' | 'failed';
  error?: ApiSendErrorKind;
};

// KeyboardButtons

export interface ApiKeyboardButtonStyle {
  type?: 'primary' | 'success' | 'destructive';
  iconId?: string;
}

export type ApiInlineButtonAction =
  { type: 'buy' | 'game' | 'disabled' | 'unsupported' }
  | { type: 'url'; url: string }
  | { type: 'webView'; url: string }
  | { type: 'callback'; data: string; requiresPassword?: boolean }
  | { type: 'switchBotInline'; query: string; isSamePeer?: boolean; peerTypes?: ApiInlineQueryPeerType[] }
  | { type: 'userProfile'; userId: string }
  | { type: 'urlAuth'; url: string; buttonId: number; forwardText?: string }
  | { type: 'copy'; copyText: string };

type ApiLocalButtonAction =
  { type: 'noForwardsRequest'; buttonType: 'accept' | 'reject' };

export type ApiKeyboardButton = {
  text: string;
  style?: ApiKeyboardButtonStyle;
  action: ApiLocalButtonAction;
};

export type KeyboardButtonNoForwardsRequest = ApiKeyboardButton & {
  action: Extract<ApiLocalButtonAction, { type: 'noForwardsRequest' }>;
};

export type ApiMessageSearchType = 'text' | 'media' | 'documents' | 'links' | 'audio' | 'voice' | 'gif'
  | 'polls' | 'profilePhoto';
export type ApiGlobalMessageSearchType = 'text' | 'media' | 'documents' | 'links' | 'audio' | 'voice';
export type ApiMessageSearchContext = 'all' | 'users' | 'groups';

export type ApiReportReason = 'spam' | 'violence' | 'pornography' | 'childAbuse'
  | 'copyright' | 'geoIrrelevant' | 'fake' | 'illegalDrugs' | 'personalDetails' | 'other';

export type ApiSendMessageAction = {
  type: 'cancel' | 'typing' | 'recordAudio' | 'recordRound' | 'chooseSticker';
} | {
  type: 'stopDraft';
  randomId: string;
};

export type ApiFactCheck = {
  shouldFetch?: true;
  hash: string;
  countryCode?: string;
  text?: ApiFormattedText;
};

export type LinkContextMessage = {
  type: 'message';
  threadId?: ThreadId;
  chatId: string;
  messageId: number;
};

export type LinkContextInner = {
  type: 'inner';
};

export type LinkContext = LinkContextMessage | LinkContextInner;

export const MAIN_THREAD_ID = -1;

// `Symbol` can not be transferred from worker
export const MESSAGE_DELETED = 'MESSAGE_DELETED';
