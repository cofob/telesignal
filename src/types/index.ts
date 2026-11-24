import type { TeactNode } from '../lib/teact/teact';

import type {
  ApiAttachment,
  ApiAudio,
  ApiBackupRemoteStatus,
  ApiBackupSettings,
  ApiChat,
  ApiChatInviteImporter,
  ApiContact,
  ApiDocument,
  ApiDraft,
  ApiExportedInvite,
  ApiFakeType,
  ApiFormattedText,
  ApiInputReplyInfo,
  ApiInputRichMessage,
  ApiKeyTransparencySelfStatus,
  ApiMediaFormat,
  ApiMessage,
  ApiMessageEntity,
  ApiNewPoll,
  ApiPageBlockPhoto,
  ApiPageBlockVideo,
  ApiPeer,
  ApiPhoto,
  ApiReaction,
  ApiSessionData,
  ApiSignalDevices,
  ApiSignalMessageSettings,
  ApiSignalPinSettings,
  ApiSticker,
  ApiStickerSet,
  ApiStory,
  ApiStorySkipped,
  ApiThemeSettings,
  ApiThreadInfo,
  ApiTypingStatus,
  ApiVideo,
  ApiVoice,
} from '../api/types';
import type { SearchResultKey } from '../util/keys/searchResultKey';
import type { IconName } from './icons';
import type { RegularLangKey } from './language';

export type TextPart = TeactNode;

export type SessionUserInfo = {
  userId?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  avatarUri?: string;
  color?: number;
  emojiStatusId?: string;
};

export type SharedSessionData = {
  pushKey?: string;
  date?: number;
} & ApiSessionData & SessionUserInfo;

export type AccountInfo = SessionUserInfo;

export enum LoadMoreDirection {
  Backwards,
  Forwards,
  Around,
}

export enum FocusDirection {
  Up,
  Down,
  Static,
}

export type ScrollTargetPosition = ScrollLogicalPosition | 'centerOrTop';

export interface IAlbum {
  albumId: string;
  // Signal: one message with several photos and videos (`MediaContent.album`) instead of grouped messages
  isSingleMessage?: true;
  messages: ApiMessage[];
  mainMessage: ApiMessage;
  captionMessage?: ApiMessage;
  hasMultipleCaptions: boolean;
  commentsMessage?: ApiMessage;
}

export interface IDocumentGroup {
  documentGroupId: string;
  messages: ApiMessage[];
  firstMessageId: number;
  commentsMessage?: ApiMessage;
}

export type ThreadId = string | number;

export type ForwardTarget = {
  chatId: string;
};

export type ThemeKey = 'light' | 'dark';
export type AnimationLevel = 0 | 1 | 2;
export type FoldersPosition = 'top' | 'left';
export type PerformanceTypeKey = (
  'pageTransitions' | 'messageSendingAnimations' | 'mediaViewerAnimations'
  | 'messageComposerAnimations' | 'contextMenuAnimations' | 'contextMenuBlur'
  | 'rightColumnAnimations' | 'animatedEmoji' | 'loopAnimatedStickers' | 'reactionEffects' | 'stickerEffects'
  | 'autoplayGifs' | 'autoplayVideos' | 'storyRibbonAnimations' | 'textStreaming'
);
export type PerformanceType = Record<PerformanceTypeKey, boolean>;

export interface IThemeSettings {
  // An empty string selects the built-in wallpaper; `undefined` allows the color theme's wallpaper
  background?: string;
  backgroundColor?: string;
  secondBackgroundColor?: string;
  thirdBackgroundColor?: string;
  fourthBackgroundColor?: string;
  backgroundRotation?: number;
  patternColor?: string;
  patternIntensity?: number;
  // User-chosen 0–100 scale applied on top of the wallpaper's own intensity; `undefined` means the default
  patternIntensityFactor?: number;
  isPattern?: boolean;
  isBlurred?: boolean;
  serverThemeSettings?: ApiThemeSettings;
  chatThemeEmoticon?: string;
  // Signal's palette and plain default wallpaper replace the built-in Telegram ones
  isSignalTheme?: boolean;
}

export type LangCode = (
  'en' | 'ar' | 'be' | 'ca' | 'nl' | 'fr' | 'de' | 'id' | 'it' | 'ko' | 'ms' | 'fa' | 'pl' | 'pt-br' | 'ru' | 'es'
  | 'tr' | 'uk' | 'uz'
);

export type TimeFormat = '24h' | '12h';

export interface AccountSettings {
  hasWebNotifications: boolean;
  shouldShowPushPreviewsWhenLocked: boolean;
  hasContactJoinedNotifications?: boolean;
  shouldNotifyAboutPinnedMessages: boolean;
  notificationSoundVolume: number;
  canAutoLoadPhotoFromContacts: boolean;
  canAutoLoadPhotoInPrivateChats: boolean;
  canAutoLoadPhotoInGroups: boolean;
  canAutoLoadVideoFromContacts: boolean;
  canAutoLoadVideoInPrivateChats: boolean;
  canAutoLoadVideoInGroups: boolean;
  canAutoLoadFileFromContacts: boolean;
  canAutoLoadFileInPrivateChats: boolean;
  canAutoLoadFileInGroups: boolean;
  autoLoadFileMaxSizeMb: number;
  shouldSuggestStickers: boolean;
  shouldSuggestCustomEmoji: boolean;
  shouldUpdateStickerSetOrder: boolean;
  lastRecordMessageMode?: 'voice' | 'video';
  // Registered primary devices only
  signalPin?: ApiSignalPinSettings;
  backups?: ApiBackupSettings;
  backupRemote?: ApiBackupRemoteStatus;
  signalDevices?: ApiSignalDevices;
  signalMessageSettings?: ApiSignalMessageSettings;
  // The result of the last key transparency check of our own account
  keyTransparencySelfStatus?: ApiKeyTransparencySelfStatus;
  isSignalContactDiscoveryEnabled?: boolean;
  isSensitiveEnabled?: boolean;
  canChangeSensitive?: boolean;
  shouldArchiveAndMuteNewNonContact?: boolean;
  defaultHistoryTtl?: number;
  shouldHideReadMarks?: boolean;
}

export type IAnchorPosition = {
  x: number;
  y: number;
  width?: number;
  height?: number;
};

export type SettingsHighlight = {
  langKey: RegularLangKey;
};

export type SettingsConfirmation = 'logOut';

export type SettingsAction = SettingsConfirmation | 'openSupport'
  | 'openPrivacyPolicy' | 'uploadWallpaper' | 'resetWallpaper' | 'clearMediaCache' | 'setBirthday'
  | 'setAccountTtl';

export enum SettingsScreens {
  Main,
  Search,
  EditProfile,
  Notifications,
  DataStorage,
  Language,
  General,
  GeneralChatBackground,
  GeneralChatBackgroundColor,
  Privacy,
  AutoDeleteMessages,
  PrivacyPhoneNumber,
  PrivacyAddByPhone,
  PrivacyLastSeen,
  PrivacyProfilePhoto,
  PrivacyBio,
  PrivacyBirthday,
  PrivacySavedMusic,
  PrivacyPhoneCall,
  PrivacyPhoneP2P,
  PrivacyForwarding,
  PrivacyVoiceMessages,
  PrivacyGroupChats,
  PrivacyPhoneNumberAllowedContacts,
  PrivacyPhoneNumberDeniedContacts,
  PrivacyLastSeenAllowedContacts,
  PrivacyLastSeenDeniedContacts,
  PrivacyProfilePhotoAllowedContacts,
  PrivacyProfilePhotoDeniedContacts,
  PrivacyBioAllowedContacts,
  PrivacyBioDeniedContacts,
  PrivacyBirthdayAllowedContacts,
  PrivacyBirthdayDeniedContacts,
  PrivacySavedMusicAllowedContacts,
  PrivacySavedMusicDeniedContacts,
  PrivacyPhoneCallAllowedContacts,
  PrivacyPhoneCallDeniedContacts,
  PrivacyPhoneP2PAllowedContacts,
  PrivacyPhoneP2PDeniedContacts,
  PrivacyForwardingAllowedContacts,
  PrivacyForwardingDeniedContacts,
  PrivacyVoiceMessagesAllowedContacts,
  PrivacyVoiceMessagesDeniedContacts,
  PrivacyGroupChatsAllowedContacts,
  PrivacyGroupChatsDeniedContacts,
  PrivacyBlockedUsers,
  Performance,
  Folders,
  FoldersCreateFolder,
  FoldersEditFolder,
  FoldersEditFolderFromChatList,
  FoldersIncludedChats,
  FoldersIncludedChatsFromChatList,
  FoldersExcludedChats,
  FoldersExcludedChatsFromChatList,
  PasscodeDisabled,
  PasscodeNewPasscode,
  PasscodeNewPasscodeConfirm,
  PasscodeEnabled,
  PasscodeChangePasscodeCurrent,
  PasscodeChangePasscodeNew,
  PasscodeChangePasscodeConfirm,
  PasscodePasskeyAddConfirm,
  PasscodePasskeyRemoveConfirm,
  PasscodeTurnOff,
  PasscodeCongratulations,
  Experimental,
  Stickers,
  CustomEmoji,
  KeyboardShortcuts,
  SignalProxy,
  Stories,
  Username,
  SignalPin,
  SignalPinNew,
  SignalPinConfirm,
  SignalDevices,
  Backups,
  NotificationProfiles,
  SignalSealedSenderProxy,
}

export type StickerSetOrReactionsSetOrRecent = Pick<ApiStickerSet, (
  'id' | 'accessHash' | 'title' | 'count' | 'stickers' | 'isEmoji' | 'installedDate' | 'isArchived' |
  'hasThumbnail' | 'hasStaticThumb' | 'hasAnimatedThumb' | 'hasVideoThumb' | 'thumbCustomEmojiId'
)> & { reactions?: ApiReaction[] };

export enum LeftColumnContent {
  ChatList,
  GlobalSearch,
  Settings,
  Contacts,
  Archived,
  NewGroupStep1,
  NewGroupStep2,
  Calls,
}

export enum GlobalSearchContent {
  ChatList,
  Media,
  Links,
  Files,
  Music,
  Voice,
}

export enum RightColumnContent {
  ChatInfo,
  Management,
  PollResults,
  AddingMembers,
  NewGroup,
}

export type MediaViewerMedia = ApiPhoto | ApiVideo | ApiDocument;
export type MediaViewerPageBlock = ApiPageBlockPhoto | ApiPageBlockVideo;
export type MediaViewerPageMedia = {
  blocks: MediaViewerPageBlock[];
  sourceIds: string[];
  pageUrl?: string;
  chatId?: string;
  messageId?: number;
  threadId?: ThreadId;
  isProtected?: boolean;
};

export enum MediaViewerOrigin {
  Inline,
  Ephemeral,
  ScheduledInline,
  SharedMedia,
  ProfileAvatar,
  SettingsAvatar,
  MiddleHeaderAvatar,
  Album,
  ScheduledAlbum,
  SearchResult,
  ChannelAvatar,
  SuggestedAvatar,
  PollPreview,
  RichPageBlock,
  IVPageBlock,
  // Signal: view-once media, which opens from a placeholder without the media
  ViewOnce,
}

export enum StoryViewerOrigin {
  StoryRibbon,
  MiddleHeaderAvatar,
  ChatList,
  SearchResult,
}

export type AudioVariant = 'inline' | 'sharedMedia' | 'search' | 'attachment' | 'oneTimeModal';

export type PlaybackMediaType = 'audio' | 'voice';

export type PlaybackSource =
  | { type: 'chat'; chatId: string; threadId: ThreadId; mediaType: PlaybackMediaType }
  | { type: 'globalSearch'; mediaType: PlaybackMediaType }
  | { type: 'savedMusic'; peerId: string }
  | { type: 'single' };

export type PlaybackContextType = 'message' | 'savedMusic' | 'musicSearch';

export type PlaybackMedia = ApiAudio | ApiVoice | ApiVideo;

export type PlaybackItemRef =
  // `documentId` targets an audio block inside a rich message
  | {
    type: 'message'; chatId: string; threadId: ThreadId; messageId: number;
    documentId?: string; isScheduled?: boolean;
  }
  | { type: 'savedMusic'; peerId: string; audioId: string }
  | { type: 'musicSearch'; audioId: string };

export type PlaybackCapabilities = {
  canSeek: boolean;
  mediaSession: 'own' | 'keep' | 'clear';
  withAutoAdvance: boolean;
};

export type RoundVideoMode = 'mini' | 'large';

export type RepeatMode = 'none' | 'one' | 'all';
export type OrderMode = 'default' | 'reverse' | 'shuffle';

export type PlaylistKey = number | string;

export type ShuffleState = {
  playlist: PlaylistKey[];
  nonPlayedKeys: PlaylistKey[];
  playedKeys: PlaylistKey[];
  indexInPlayed: number;
  areAllLoaded: boolean;
};

export enum ChatCreationProgress {
  Idle,
  InProgress,
  Complete,
  Error,
}

export enum ProfileEditProgress {
  Idle,
  InProgress,
  Complete,
  Error,
}

export enum ManagementProgress {
  Idle,
  InProgress,
  Complete,
  Error,
}

export interface ManagementState {
  isActive: boolean;
  nextScreen?: ManagementScreens;
  selectedChatMemberId?: string;
  checkedUsername?: string;
  isUsernameAvailable?: boolean;
  error?: string;
  invites?: ApiExportedInvite[];
  revokedInvites?: ApiExportedInvite[];
  editingInvite?: ApiExportedInvite;
  inviteInfo?: {
    invite: ApiExportedInvite;
    importers?: ApiChatInviteImporter[];
    requesters?: ApiChatInviteImporter[];
  };
}

export enum NewChatMembersProgress {
  Closed,
  InProgress,
  Loading,
}

export type ProfileTabType =
  | 'members'
  | 'commonChats'
  | 'media'
  | 'documents'
  | 'links'
  | 'audio'
  | 'voice'
  | 'gif'
  | 'stories'
  | 'storiesArchive'
  | 'polls';
export type SharedMediaType = 'media' | 'documents' | 'links' | 'audio' | 'voice' | 'gif' | 'polls';
export type MiddleSearchType = 'chat' | 'myChats';
export type MiddleSearchParams = {
  requestedQuery?: string;
  isHashtag?: boolean;
  fromPeerId?: string;
  fetchingQuery?: string;
  type: MiddleSearchType;
  results?: MiddleSearchResults;
};
export type MiddleSearchResults = {
  query: string;
  totalCount?: number;
  nextOffsetId?: number;
  nextOffsetPeerId?: string;
  nextOffsetRate?: number;
  foundIds?: SearchResultKey[];
};

export interface LoadingState {
  areAllItemsLoadedForwards: boolean;
  areAllItemsLoadedBackwards: boolean;
}

export interface ChatMediaSearchSegment {
  foundIds: number[];
  loadingState: LoadingState;
}

export interface ChatMediaSearchParams {
  currentSegment: ChatMediaSearchSegment;
  segments: ChatMediaSearchSegment[];
  isLoading: boolean;
  pendingRequest?: {
    currentMediaMessageId: number;
    direction?: LoadMoreDirection;
  };
}

export enum ProfileState {
  Profile,
  SharedMedia,
  MemberList,
  StoryList,
}

export const UPLOADING_WALLPAPER_SLUG = 'UPLOADING_WALLPAPER_SLUG';

export enum ManagementScreens {
  Initial,
  GroupType,
  GroupPermissions,
  GroupRemovedUsers,
  GroupUserPermissionsCreate,
  GroupUserPermissions,
  ChatAdministrators,
  ChatAdminRights,
  ChatNewAdminRights,
  GroupMembers,
  GroupAddAdmins,
  Invites,
  EditInvite,
  InviteInfo,
  JoinRequests,
  GroupInvitedUsers,
}

export type ManagementType = 'user' | 'group';

export type EmojiKeywords = {
  isLoading?: boolean;
  version?: number;
  keywords?: Record<string, string[]>;
};

export type CustomPeerType = 'contacts' | 'nonContacts'
  | 'groups' | 'excludeMuted' | 'excludeArchived' | 'excludeRead' | 'stars';

export type CustomPeer = {
  isCustomPeer: true;
  key?: string | number;
  subtitleKey?: RegularLangKey;
  avatarIcon?: IconName;
  isAvatarSquare?: boolean;
  peerColorId?: number;
  isVerified?: boolean;
  fakeType?: ApiFakeType;
  emojiStatusId?: string;
  customPeerAvatarColor?: string;
} & ({
  titleKey: RegularLangKey;
  title?: undefined;
} | {
  title: string;
  titleKey?: undefined;
});

export type UniqueCustomPeer<T = CustomPeerType> = CustomPeer & {
  type: T;
};

export type MessageListType =
  'thread'
  | 'pinned'
  | 'scheduled';

export type ChatListType = 'active' | 'archived';

export interface MessageList {
  chatId: string;
  threadId: ThreadId;
  type: MessageListType;
}

export interface ActiveEmojiInteraction {
  id: number;
  x: number;
  y: number;
  messageId?: number;
  startSize?: number;
  animatedEffect?: string;
  isReversed?: boolean;
}

export type ActiveDownloads = Record<string, {
  format: ApiMediaFormat;
  filename: string;
  size: number;
  originChatId?: string;
  originMessageId?: number;
}>;

export type IDimensions = {
  width: number;
  height: number;
};

export type ConfettiStyle = 'poppers' | 'top-down';

export type TypingDraft = {
  senderId: string;
  id: string;
  date: number;
  text: ApiFormattedText;
};

export interface TabThread {
  scrollOffset?: number;
  replyStack?: number[];
  viewportIds?: number[];
}

export interface ThreadReadState {
  unreadCount?: number;
  unreadMentionsCount?: number;
  unreadMentions?: number[];
  hasUnreadMark?: boolean;

  lastReadOutboxMessageId?: number;
  lastReadInboxMessageId?: number;
}

export interface ThreadLocalState {
  lastScrollOffset?: number;
  lastViewportIds?: number[];
  listedIds?: number[];
  outlyingLists?: number[][];
  pinnedIds?: number[];
  scheduledIds?: number[];
  firstMessageId?: number;

  editingId?: number;
  editingScheduledId?: number;
  editingDraft?: EditingDraft;
  editingScheduledDraft?: EditingDraft;

  draft?: ApiDraft;

  noWebPage?: boolean;
  webPagePreviewId?: string;

  typingStatusByPeerId?: Record<string, ApiTypingStatus>;

  typingDraftIdByRandomId?: Record<string, number>;
}

export type EditingDraft = (ApiFormattedText & {
  richMessage?: never;
}) | {
  text?: never;
  entities?: never;
  richMessage: ApiInputRichMessage;
};

export interface Thread {
  localState: ThreadLocalState;
  threadInfo: ApiThreadInfo;
  readState: ThreadReadState;
}

export type ConfettiParams = OptionalCombine<{
  style?: ConfettiStyle;
  withStars?: boolean;
}, {
  top?: number;
  left?: number;
  width?: number;
  height?: number;
}>;

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export type WebPageMediaSize = 'large' | 'small';

export type AttachmentCompression = 'compress' | 'original';

export type SendMessageParams = {
  chat?: ApiChat;
  attachments?: ApiAttachment[];
  lastMessageId?: number;
  text?: string;
  entities?: ApiMessageEntity[];
  richMessage?: ApiInputRichMessage;
  replyInfo?: ApiInputReplyInfo;
  attachment?: ApiAttachment;
  sticker?: ApiSticker;
  story?: ApiStory | ApiStorySkipped;
  gif?: ApiVideo;
  audio?: ApiAudio;
  poll?: ApiNewPoll;
  dice?: string;
  contact?: ApiContact;
  isSilent?: boolean;
  scheduledAt?: number;
  groupedId?: string;
  noWebPage?: boolean;
  sendAs?: ApiPeer;
  shouldGroupMessages?: boolean;
  shouldUpdateStickerSetOrder?: boolean;
  wasDrafted?: boolean;
  isInvertedMedia?: true;
  webPageMediaSize?: WebPageMediaSize;
  webPageUrl?: string;
  starsAmount?: number;
  isPending?: true;
  messageList?: MessageList;
  isReaction?: true; // Reaction to the story are sent in the form of a message
  localMessage?: ApiMessage;
  forwardedLocalMessagesSlice?: ForwardedLocalMessagesSlice;
  forwardParams?: ForwardMessagesParams;
  isStoryReply?: boolean;
};

export type ForwardedLocalMessagesSlice = {
  messageIds: number[];
  localMessages: ApiMessage[];
};

export type ForwardMessagesParams = {
  fromChat: ApiChat;
  toChat: ApiChat;
  toThreadId?: ThreadId;
  messages: ApiMessage[];
  isSilent?: boolean;
  scheduledAt?: number;
  sendAs?: ApiPeer;
  withMyScore?: boolean;
  noAuthors?: boolean;
  noCaptions?: boolean;
  privateForwardName?: string;
  wasDrafted?: boolean;
  lastMessageId?: number;
  // The local ids of the forwarded messages, when the caller follows their copies before they are stored
  localIds?: number[];
  forwardedLocalMessagesSlice?: ForwardedLocalMessagesSlice;
};
