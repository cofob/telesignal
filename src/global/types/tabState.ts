import type {
  ApiAudio,
  ApiBirthday,
  ApiChatInviteInfo,
  ApiChatType,
  ApiDialog,
  ApiFormattedText,
  ApiGlobalMessageSearchType,
  ApiKeyTransparencyStatus,
  ApiLanguage,
  ApiLimitTypeWithModal,
  ApiMessage,
  ApiMessageRecipient,
  ApiMissingInvitedUser,
  ApiNewPoll,
  ApiNotification,
  ApiReaction,
  ApiRichText,
  ApiSticker,
  ApiTypeStoryView,
  ApiVideo,
} from '../../api/types';
import type { FoldersActions } from '../../hooks/reducers/useFoldersReducer';
import type { ReducerAction } from '../../hooks/useReducer';
import type {
  ActiveDownloads,
  ActiveEmojiInteraction,
  ChatCreationProgress,
  ChatMediaSearchParams,
  ConfettiStyle,
  FocusDirection,
  GlobalSearchContent,
  IAnchorPosition,
  LeftColumnContent,
  ManagementProgress,
  ManagementState,
  MediaViewerMedia,
  MediaViewerOrigin,
  MediaViewerPageMedia,
  MessageList,
  MessageListType,
  MiddleSearchParams,
  NewChatMembersProgress,
  PlaybackItemRef,
  PlaybackSource,
  ProfileEditProgress,
  ProfileTabType,
  RoundVideoMode,
  ScrollTargetPosition,
  SettingsConfirmation,
  SettingsHighlight,
  SettingsScreens,
  SharedMediaType,
  ShuffleState,
  StoryViewerOrigin,
  TabThread,
  ThreadId,
} from '../../types';
import type { RegularLangKey } from '../../types/language';
import type { SearchResultKey } from '../../util/keys/searchResultKey';

export type PollVote = {
  peerId: string;
  date: number;
};

export type MusicPickerSharedResults = {
  generation: number;
  ids: SearchResultKey[];
  loadedCount?: number;
  nextOffsetRate?: number;
  nextOffsetId?: number;
  nextOffsetPeerId?: string;
  totalCount?: number;
  isLoading?: boolean;
  isFullyLoaded?: boolean;
};

export type TabState = {
  id: number;
  isBlurred?: boolean;
  isMasterTab: boolean;
  inactiveReason?: 'auth' | 'otherClient';
  shouldPreventComposerAnimation?: boolean;
  isRichInputExpanded?: boolean;
  richMediaUploadBlockingCount?: number;
  inviteHash?: string;
  canInstall?: boolean;
  isLeftColumnShown: boolean;
  newChatMembersProgress?: NewChatMembersProgress;
  uiReadyState: 0 | 1 | 2;
  shouldInit: boolean;
  shouldSkipHistoryAnimations?: boolean;

  shouldCloseRightColumn?: boolean;
  chatInfo: {
    isOpen: boolean;
    profileTab?: ProfileTabType;
    forceScrollProfileTab?: boolean;
    isOwnProfile?: boolean;
  };
  nextFoldersAction?: ReducerAction<FoldersActions>;

  messageLists: MessageList[];
  globalThemePreviewChatId?: string;

  contentToBeScheduled?: {
    gif?: ApiVideo;
    sticker?: ApiSticker;
    poll?: ApiNewPoll;
    isSilent?: boolean;
    sendGrouped?: boolean;
    sendCompressed?: boolean;
    isInvertedMedia?: true;
  };

  activeChatFolder: number;
  tabThreads: Record<string, Record<ThreadId, TabThread>>;

  focusedMessage?: {
    chatId?: string;
    threadId?: ThreadId;
    messageId?: number;
    direction?: FocusDirection;
    noHighlight?: boolean;
    isResizingContainer?: boolean;
    quote?: string;
    quoteOffset?: number;
    pollOption?: string;
    scrollTargetPosition?: ScrollTargetPosition;
  };

  selectedMessages?: {
    chatId: string;
    messageIds: number[];
  };

  chatInviteModal?: {
    hash: string;
    inviteInfo: ApiChatInviteInfo;
  };

  seenByModal?: {
    chatId: string;
    messageId: number;
  };

  privacySettingsNoticeModal?: {
    chatId: string;
    isReadDate: boolean;
  };

  reactorModal?: {
    chatId: string;
    messageId: number;
  };

  reactionPicker?: {
    chatId?: string;
    messageId?: number;
    storyPeerId?: string;
    storyId?: number;
    position?: IAnchorPosition;
    sendAsMessage?: boolean;
  };

  leftColumn: {
    contentKey: LeftColumnContent;
    settingsScreen: SettingsScreens;
    settingsHighlight?: SettingsHighlight;
  };

  globalSearch: {
    query?: string;
    minDate?: number;
    maxDate?: number;
    currentContent?: GlobalSearchContent;
    chatId?: string;
    fetchingStatus?: {
      chats?: boolean;
      messages?: boolean;
    };
    isClosing?: boolean;
    localResults?: {
      peerIds?: string[];
    };
    globalResults?: {
      peerIds?: string[];
    };
    resultsByType?: Partial<Record<ApiGlobalMessageSearchType, {
      totalCount?: number;
      nextOffsetId?: number;
      nextOffsetPeerId?: string;
      nextOffsetRate?: number;
      foundIds: SearchResultKey[];
    }>>;
  };

  activeEmojiInteractions?: ActiveEmojiInteraction[];
  activeReactions: Record<string, ApiReaction[]>;

  middleSearch: {
    byChatThreadKey: Record<string, MiddleSearchParams | undefined>;
  };

  sharedMediaSearch: {
    byChatThreadKey: Record<string, {
      currentType?: SharedMediaType;
      resultsByType?: Partial<Record<SharedMediaType, {
        totalCount?: number;
        nextOffsetId: number;
        foundIds: number[];
      }>>;
    }>;
  };

  chatMediaSearch: {
    byChatThreadKey: Record<string, ChatMediaSearchParams>;
  };

  management: {
    progress?: ManagementProgress;
    byChatId: Record<string, ManagementState>;
  };

  storyViewer: {
    isRibbonShown?: boolean;
    isArchivedRibbonShown?: boolean;
    peerId?: string;
    storyId?: number;
    isMuted: boolean;
    isSinglePeer?: boolean;
    isSingleStory?: boolean;
    isPrivate?: boolean;
    isArchive?: boolean;
    // Last viewed story id in current view session.
    // Used for better switch animation between peers.
    lastViewedByPeerId?: Record<string, number>;
    isPrivacyModalOpen?: boolean;
    isPaymentConfirmDialogOpen?: boolean;
    viewModal?: {
      storyId: number;
      views?: ApiTypeStoryView[];
      nextOffset?: string;
      isLoading?: boolean;
    };
    origin?: StoryViewerOrigin;
    // Copy of story list for current view session
    storyList?: {
      peerIds: string[];
      storyIdsByPeerId: Record<string, number[]>;
    };
  };
  storyComposerModal?: {
    // The story is on its way, so it cannot be sent again
    isSending?: boolean;
  };

  selectedStoryAlbumId?: number;

  mediaViewer: {
    chatId?: string;
    threadId?: ThreadId;
    messageId?: number;
    withDynamicLoading?: boolean;
    mediaIndex?: number;
    isAvatarView?: boolean;
    standaloneMedia?: MediaViewerMedia[];
    pageMedia?: MediaViewerPageMedia;
    origin?: MediaViewerOrigin;
    volume: number;
    playbackRate: number;
    isMuted: boolean;
    isHidden?: boolean;
    timestamp?: number;
    shouldLandInMediaEditor?: boolean;
    // Signal: the media of an opened view-once message, already erased in the engine, which closing the viewer
    // lets go of
    viewOnceMedia?: { hash: string; blobUrl: string };
  };

  audioPlayer: {
    activeItem?: PlaybackItemRef;
    source?: PlaybackSource;
    playbackRate: number;
    isPlaybackRateActive?: boolean;
    timestamp?: number;
    isMuted: boolean;
    shuffle?: ShuffleState;
    pendingStep?: {
      direction: 'next' | 'prev';
      isAuto?: boolean;
    };
    // Round video leaves its message for the floating player even while the message is visible
    roundVideoMode?: RoundVideoMode;
  };

  isAudioPlaylistModalOpen?: boolean;

  loadingThread?: {
    loadingChatId: string;
    loadingMessageId: number;
  };

  isShareMessageModalShown?: boolean;

  replyingMessage: {
    fromChatId?: string;
    messageId?: number;
    quoteText?: ApiFormattedText;
    quoteRich?: ApiRichText[];
    quoteOffset?: number;
    toChatId?: string;
    toThreadId?: ThreadId;
  };

  forwardMessages: {
    fromChatId?: string;
    messageIds?: number[];
    storyId?: number;
    audioItem?: PlaybackItemRef;
    toChatId?: string;
    toThreadId?: ThreadId;
    withMyScore?: boolean;
    noAuthors?: boolean;
    noCaptions?: boolean;
  };

  pollResults: {
    chatId?: string;
    messageId?: number;
    votesByOption?: Record<string, PollVote[]>;
    offsets?: Record<string, string>;
  };

  chatCreation?: {
    progress: ChatCreationProgress;
    error?: RegularLangKey;
  };

  profileEdit?: {
    progress: ProfileEditProgress;
    checkedUsername?: string;
    isUsernameAvailable?: boolean;
    error?: string;
  };

  // Signal username screen: the reservation that saving sets, why the last request failed, and our username link
  usernameEdit?: {
    reservedUsername?: string;
    isReserving?: boolean;
    isSaving?: boolean;
    error?: string;
    link?: string;
  };

  notifications: ApiNotification[];
  dialogs: ApiDialog[];

  safeLinkModalUrl?: string;
  historyCalendarSelectedAt?: number;
  openedStickerSetShortName?: string;
  openedCustomEmojiSetIds?: string[];

  activeDownloads: ActiveDownloads;
  // Keys (media hashes) of the files that the desktop app saved and that still exist
  savedFiles: Record<string, true>;

  newContact?: {
    userId?: string;
    isByPhoneNumber?: boolean;
  };

  requestedDraft?: {
    chatId?: string;
    text: ApiFormattedText;
    files?: File[];
    filter?: ApiChatType[];
  };

  requestedRichInputMedia?: {
    chatId: string;
    threadId: ThreadId;
    messageListType: MessageListType;
    audio?: ApiAudio;
    files?: File[];
  };

  pollModal?: {
    chatId: string;
    threadId?: ThreadId;
    messageListType: MessageListType;
  };

  musicPicker?: {
    chatId: string;
    threadId: ThreadId;
    messageListType: MessageListType;
    shouldInsertToRichInput?: boolean;
    shared?: MusicPickerSharedResults;
  };

  confetti?: {
    lastConfettiTime?: number;
    top?: number;
    left?: number;
    width?: number;
    height?: number;
    style?: ConfettiStyle;
    withStars?: boolean;
  };
  wave?: {
    lastWaveTime: number;
    startX: number;
    startY: number;
  };

  languageModal?: {
    requestId: number;
    langCode: string;
    language?: ApiLanguage;
    isLoading?: boolean;
    isApplying?: boolean;
    error?: 'unsupported' | 'failed';
  };

  deleteMessageModal?: {
    chatId: string;
    messageIds: number[];
    isSchedule?: boolean;
    onConfirm?: NoneToVoidFunction;
  };

  deleteMemberModal?: {
    chatId: string;
    peerId: string;
  };

  isQuickChatPickerOpen?: boolean;

  isFrozenAccountModalOpen?: boolean;

  disableSharingAboutModal?: {
    userId: string;
  };

  limitReachedModal?: {
    limit: ApiLimitTypeWithModal;
  };

  deleteFolderDialogModal?: number;

  deleteAccountModal?: {
    selfDestructAccountDays: number;
  };

  isAgeVerificationModalOpen?: boolean;

  birthdaySetupModal?: {
    currentBirthday?: ApiBirthday;
    suggestForUserId?: string;
    isFromSuggestion?: boolean;
  };

  inviteViaLinkModal?: {
    missingUsers: ApiMissingInvitedUser[];
    chatId: string;
  };

  oneTimeMediaModal?: {
    message: ApiMessage;
  };

  qrCodeModal?: {
    peerId: string;
  };

  // Signal: a phone number from a link, which the contact discovery service looks up once the user confirms
  phoneNumberLookupModal?: {
    phoneNumber: string;
  };

  // Signal: the server lookup of a username that the user chose from the search results
  usernameLookup?: {
    username: string;
    status: 'loading' | 'notFound' | 'unavailable';
  };

  // Signal: a link to something that this app does not do, which the dialog explains; `host` is the proxy's
  linkDeviceModal?: {
    // The link of the device to link, when it came from a `sgnl://linkdevice` link
    url?: string;
  };

  signalLinkModal?: {
    type: 'proxy' | 'callLink' | 'linkDevice' | 'reRegister';
    host?: string;
  };

  // Signal: the safety number with a contact; `isUnavailable` while we do not know their identity key
  safetyNumberModal?: {
    userId: string;
    digits?: string;
    qrData?: string;
    isVerified?: boolean;
    isUnavailable?: boolean;
    keyTransparencyStatus?: ApiKeyTransparencyStatus;
  };

  // Signal: a message that was not sent to `userIds` because their safety numbers changed
  safetyNumberChangeModal?: {
    chatId: string;
    messageId: number;
    userIds: string[];
  };

  // Signal: how sending an outgoing message to each recipient went; `recipients` load after the modal opens
  messageDetailsModal?: {
    chatId: string;
    messageId: number;
    recipients?: ApiMessageRecipient[];
  };

  // Signal: the recovery key of the account, shown in the format of Signal; `isUnconfirmed` for a new account
  recoveryKeyModal?: {
    key: string;
    isUnconfirmed?: boolean;
  };

  quickPreview?: {
    chatId: string;
  };

  settingsConfirmation?: SettingsConfirmation;

  autoDeleteTimerModal?: {
    chatId: string;
  };

  insertingPeerIdMention?: string;
  shouldSaveAttachmentsCompression?: boolean;

  rankModal?: {
    chatId: string;
    userId: string;
    isAdmin?: boolean;
    isOwner?: boolean;
    rank?: string;
  };
  editRankModal?: {
    chatId: string;
    userId: string;
    isAdmin?: boolean;
    isOwner?: boolean;
    rank?: string;
  };
  messageMediaEditorRequest?: {
    chatId: string;
    messageId: number;
    videoTime?: number;
  };
};
