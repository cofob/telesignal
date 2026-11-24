import type {
  ApiAttachment,
  ApiAudio,
  ApiAuthCodeTransport,
  ApiAvatarUpload,
  ApiBackupFrequency,
  ApiBirthday,
  ApiChat,
  ApiChatAdminRights,
  ApiChatBannedRights,
  ApiChatFolder,
  ApiChatType,
  ApiDraft,
  ApiEmojiStatus,
  ApiExportedInvite,
  ApiFormattedText,
  ApiGlobalMessageSearchType,
  ApiInlineButtonAction,
  ApiInputEphemeralReplyInfo,
  ApiInputMessageReplyInfo,
  ApiInputRichMessage,
  ApiLanguage,
  ApiLimitTypeWithModal,
  ApiMessage,
  ApiMessageEntity,
  ApiMessageSearchContext,
  ApiNewStory,
  ApiNotification,
  ApiNotificationProfile,
  ApiNotifyPeerType,
  ApiPhoto,
  ApiPrivacyKey,
  ApiPrivacySettings,
  ApiReaction,
  ApiRichText,
  ApiSendMessageAction,
  ApiSessionData,
  ApiSignalMessageSettings,
  ApiSticker,
  ApiStickerSet,
  ApiStickerSetInfo,
  ApiStoryDistributionList,
  ApiStorySettings,
  ApiTopPeerCategory,
  ApiUpdate,
  ApiVideo,
  LinkContext,
  PrivacyVisibility,
} from '../../api/types';
import type { FoldersActions } from '../../hooks/reducers/useFoldersReducer';
import type { ReducerAction } from '../../hooks/useReducer';
import type {
  AccountSettings,
  AttachmentCompression,
  ChatListType,
  ConfettiParams,
  EditingDraft,
  ForwardTarget,
  GlobalSearchContent,
  IAnchorPosition,
  IThemeSettings,
  LeftColumnContent,
  LoadMoreDirection,
  ManagementScreens,
  MediaViewerMedia,
  MediaViewerOrigin,
  MediaViewerPageMedia,
  MessageList,
  MessageListType,
  MiddleSearchParams,
  NewChatMembersProgress,
  OrderMode,
  PerformanceType,
  PlaybackItemRef,
  PlaybackSource,
  ProfileTabType,
  RepeatMode,
  RoundVideoMode,
  ScrollTargetPosition,
  SendMessageParams,
  SettingsConfirmation,
  SettingsHighlight,
  SettingsScreens,
  SharedMediaType,
  StoryViewerOrigin,
  ThemeKey,
  ThreadId,
  WebPageMediaSize,
} from '../../types';
import type { MediaEditorSettings } from '../../types/mediaEditor';
import type { ClipboardTextFormat, MessageCopyRequest } from '../../types/messageCopy';
import type { KeyboardShortcutId } from '../../util/keyboardShortcuts/registry';
import type { RegularLangFnParameters } from '../../util/localization';
import type { DownloadableMedia } from '../helpers';
import type { SharedState } from './sharedState';
import type { TabState } from './tabState';

export type WithTabId = { tabId?: number };

export interface ActionPayloads {
  // system
  init: ({
    isMasterTab?: boolean;
  } & WithTabId) | undefined;
  reset: undefined;
  disconnect: undefined;
  initApi: undefined;
  initMain: undefined;
  sync: undefined;
  saveSession: {
    sessionData?: ApiSessionData;
  };

  // auth
  setAuthPhoneNumber: { phoneNumber: string };
  setAuthCode: { code: string };
  setAuthCaptcha: { captchaLink: string };
  requestAuthCode: { transport: ApiAuthCodeTransport };
  setAuthPassword: { password: string };
  signUp: {
    firstName: string;
    lastName: string;
    isDiscoverableByPhoneNumber?: boolean;
  };
  returnToAuthPhoneNumber: undefined;
  setAuthRememberMe: { value: boolean };
  clearAuthErrorKey: undefined;
  uploadProfilePhoto: {
    photo: ApiAvatarUpload;
    isFallback?: boolean;
  } & WithTabId;
  goToAuthQrCode: undefined;

  // stickers & GIFs
  saveGif: {
    gif: ApiVideo;
    shouldUnsave?: boolean;
  } & WithTabId;
  faveSticker: { sticker: ApiSticker } & WithTabId;
  unfaveSticker: { sticker: ApiSticker };
  toggleStickerSet: { stickerSetId: string };
  loadEmojiKeywords: { language: string };
  loadEmojiSearchGroups: undefined;
  loadEmojiStickerGroups: undefined;

  // groups
  updateChatDefaultBannedRights: {
    chatId: string;
    bannedRights: ApiChatBannedRights;
  };
  updateChatMemberBannedRights: {
    chatId: string;
    peerId: string;
    bannedRights: ApiChatBannedRights;
  } & WithTabId;
  updateChatAdmin: {
    chatId: string;
    userId: string;
    adminRights: ApiChatAdminRights;
    rank?: string;
  } & WithTabId;
  editChatParticipantRank: {
    chatId: string;
    userId: string;
    rank: string;
  };

  checkChatInvite: {
    hash: string;
  } & WithTabId;
  acceptChatInvite: { hash: string; isBroadcast?: boolean } & WithTabId;
  closeChatInviteModal: WithTabId | undefined;

  // settings
  setSettingOption: Partial<AccountSettings> | undefined;
  setSharedSettingOption: Partial<SharedState['settings']> | undefined;
  setSignalProxyUrl: { url?: string };
  setSignalSealedSenderProxyUrl: { url?: string };
  // The proxy servers that the other frontend stored, for the shared state of this tab
  applyOtherClientProxySettings: Partial<
    Pick<SharedState['settings'], 'signalProxyUrl' | 'signalSealedSenderProxyUrl'>
  >;
  setKeyboardShortcut: {
    id: KeyboardShortcutId;
    combo: string | false;
  };
  resetKeyboardShortcuts: {
    id: KeyboardShortcutId;
  } | undefined;
  updatePerformanceSettings: Partial<PerformanceType>;
  loadBlockedUsers: {
    isOnlyStories?: boolean;
  } | undefined;
  blockUser: {
    userId: string;
    isOnlyStories?: boolean;
  };
  unblockUser: {
    userId: string;
    isOnlyStories?: boolean;
  };

  loadNotificationSettings: undefined;
  updateContactSignUpNotification: {
    isSilent: boolean;
  };
  updateNotificationSettings: {
    peerType: ApiNotifyPeerType;
    isMuted?: boolean;
    shouldShowPreviews?: boolean;
  };

  updateWebNotificationSettings: {
    shouldShowPushPreviewsWhenLocked?: boolean;
    hasWebNotifications?: boolean;
    notificationSoundVolume?: number;
  };
  loadLanguages: undefined;
  openLanguageModal: { langCode: string } & WithTabId;
  closeLanguageModal: WithTabId | undefined;
  applyLanguage: { language: ApiLanguage } & WithTabId;
  removeCustomLanguage: { langCode: string };

  loadSignalPinSettings: undefined;
  restoreAuthBackup: { recoveryKey: string; file?: File };
  skipAuthRestore: undefined;
  loadBackupSettings: undefined;
  loadBackupRemoteStatus: undefined;
  enableBackups: { frequency: ApiBackupFrequency; shouldReplaceBackup?: boolean } & WithTabId;
  disableBackups: { shouldDeleteBackup?: boolean } & WithTabId;
  setBackupFrequency: { frequency: ApiBackupFrequency } & WithTabId;
  backUpNow: WithTabId | undefined;
  cancelBackup: undefined;
  exportBackupFile: WithTabId | undefined;
  importBackupFile: { file: File; recoveryKey: string } & WithTabId;
  loadSignalDevices: undefined;
  loadSignalMessageSettings: undefined;
  updateSignalMessageSettings: Partial<ApiSignalMessageSettings>;
  linkSignalDevice: { url: string } & WithTabId;
  unlinkSignalDevice: { deviceId: number } & WithTabId;
  openSignalLinkDevice: { url: string } & WithTabId;
  openLinkDeviceModal: { url?: string } & WithTabId;
  closeLinkDeviceModal: WithTabId | undefined;
  setSignalPin: {
    pin: string;
  } & WithTabId;
  removeSignalPin: WithTabId | undefined;
  setSignalRegistrationLock: {
    isEnabled: boolean;
  } & WithTabId;
  loadSignalContactDiscovery: undefined;
  setSignalContactDiscovery: {
    isEnabled: boolean;
  } & WithTabId;
  openPhoneNumberLookupModal: {
    phoneNumber: string;
  } & WithTabId;
  closePhoneNumberLookupModal: WithTabId | undefined;
  openSignalLinkModal: NonNullable<TabState['signalLinkModal']> & WithTabId;
  closeSignalLinkModal: WithTabId | undefined;
  openSettingsConfirmation: {
    confirmation: SettingsConfirmation;
  } & WithTabId;
  closeSettingsConfirmation: WithTabId | undefined;

  loadPrivacySettings: {
    skipIfCached?: boolean;
  };
  setPrivacyVisibility: {
    privacyKey: ApiPrivacyKey;
    visibility: PrivacyVisibility;
    onSuccess?: VoidFunction;
  };

  setPrivacySettings: {
    privacyKey: ApiPrivacyKey;
    isAllowList: boolean;
    updatedIds: string[];
  };
  loadNotificationExceptions: undefined;
  setThemeSettings: { theme: ThemeKey } & Partial<IThemeSettings>;
  syncGlobalWallpaperCache: { background: string };
  animateMessageSending: { chatId: string; threadId: ThreadId; tabId: number };
  updateIsOnline: { isOnline: boolean };

  loadContentSettings: undefined;
  updateContentSettings: { isSensitiveEnabled: boolean };

  loadCountryList: {
    langCode?: string;
  };
  ensureTimeFormat: undefined;

  // misc
  loadWebPagePreview: {
    chatId: string;
    threadId: ThreadId;
    text: ApiFormattedText;
  };
  loadWebPage: {
    url: string;
    hash?: number;
  };
  clearWebPagePreview: {
    chatId: string;
    threadId: ThreadId;
  };
  loadWallpapers: undefined;
  uploadWallpaper: File;
  loadChatThemes: undefined;
  applyChatTheme: { emoticon?: string; isSignalTheme?: boolean } & WithTabId;
  saveCloseFriends: {
    userIds: string[];
  };
  toggleNoForwards: {
    userId: string;
    isEnabled: boolean;
    requestMsgId?: number;
  };

  // Message search
  openMiddleSearch: {
    fromPeerId?: string;
  } & WithTabId | undefined;
  closeMiddleSearch: WithTabId | undefined;
  updateMiddleSearch: {
    chatId: string;
    threadId?: ThreadId;
    update: Partial<Omit<MiddleSearchParams, 'results'>>;
  } & WithTabId;
  resetMiddleSearch: WithTabId | undefined;
  performMiddleSearch: {
    chatId: string;
    threadId?: ThreadId;
    query?: string;
  } & WithTabId;
  searchHashtag: {
    hashtag: string;
  } & WithTabId;
  setSharedMediaSearchType: {
    mediaType?: SharedMediaType;
  } & WithTabId;
  searchSharedMediaMessages: WithTabId | undefined;
  searchChatMediaMessages: {
    currentMediaMessageId: number;
    direction?: LoadMoreDirection;
    chatId?: string;
    threadId?: ThreadId;
    mediaType?: SharedMediaType;
    limit?: number;
  } & WithTabId;
  searchMessagesByDate: {
    timestamp: number;
  } & WithTabId;

  toggleChatInfo: ({ force?: boolean } & WithTabId) | undefined;
  setIsUiReady: {
    uiReadyState: 0 | 1 | 2;
  } & WithTabId;
  toggleLeftColumn: WithTabId | undefined;

  addChatMembers: {
    chatId: string;
    memberIds: string[];
  } & WithTabId;
  deleteChatMember: {
    chatId: string;
    peerId: string;
  } & WithTabId;
  openPreviousChat: WithTabId | undefined;
  editChatFolders: {
    chatId: string;
    idsToRemove: number[];
    idsToAdd: number[];
  } & WithTabId;
  setChatHistoryTtl: {
    chatId: string;
    period: number;
  };
  preloadTopChatMessages: undefined;
  loadAllChats: {
    listType: ChatListType;
    whenFirstBatchDone?: () => Promise<void>;
  };
  openChatWithInfo: ActionPayloads['openChat'] & {
    profileTab?: ProfileTabType;
    forceScrollProfileTab?: boolean;
    isOwnProfile?: boolean;
  } & WithTabId;
  setActiveChatFolder: {
    activeChatFolder: number;
  } & WithTabId;
  openNextChat: {
    orderedIds: string[];
    targetIndexDelta: number;
  } & WithTabId;
  joinChannel: {
    chatId: string;
  } & WithTabId;
  leaveBasicGroup: {
    chatId: string;
  } & WithTabId;
  toggleChatPinned: {
    id: string;
    folderId: number;
  } & WithTabId;
  toggleChatArchived: {
    id: string;
  };
  markChatUnread: { id: string };
  markChatRead: { id: string };
  markChatMessagesRead: { id: string };
  loadChatFolders: undefined;
  editChatFolder: {
    id: number;
    folderUpdate: Omit<ApiChatFolder, 'id' | 'description' | 'emoticon'>;
  };
  addChatFolder: {
    folder: ApiChatFolder;
  } & WithTabId;
  deleteChatFolder: {
    id: number;
  };
  openChatByPhoneNumber: {
    phoneNumber: string;
    text?: string;
  } & WithTabId;
  findChatByUsername: {
    username: string;
  } & WithTabId;
  openChatByContactToken: {
    token: string;
  } & WithTabId;
  // global search
  setGlobalSearchQuery: {
    query?: string;
  } & WithTabId;
  searchMessagesGlobal: {
    type: ApiGlobalMessageSearchType;
    context?: ApiMessageSearchContext;
    shouldResetResultsByType?: boolean;
    shouldCheckFetchingMessagesStatus?: boolean;
  } & WithTabId;
  addRecentlyFoundChatId: {
    id: string;
  };
  clearRecentlyFoundChats: undefined;
  setGlobalSearchContent: {
    content?: GlobalSearchContent;
  } & WithTabId;
  setGlobalSearchChatId: {
    id?: string;
  } & WithTabId;
  setGlobalSearchDate: {
    date?: number;
  } & WithTabId;

  // scheduled messages
  loadScheduledHistory: {
    chatId: string;
  };
  sendScheduledMessages: {
    chatId: string;
    id: number;
  };
  rescheduleMessage: {
    chatId: string;
    messageId: number;
    scheduledAt: number;
  };
  deleteScheduledMessages: { messageIds: number[] } & WithTabId;
  // Message
  loadViewportMessages: {
    direction?: LoadMoreDirection;
    isBudgetPreload?: boolean;
    chatId?: string;
    threadId?: ThreadId;
    shouldForceRender?: boolean;
    forceLastSlice?: boolean;
    onLoaded?: NoneToVoidFunction;
    onError?: NoneToVoidFunction;
  } & WithTabId;
  cleanupExpiredTtlMessages: {
    chatId?: string;
    messageIds?: number[];
  } | undefined;
  sendMessage: Partial<SendMessageParams> & WithTabId;
  sendDiceInCurrentChat: {
    emoji: string;
  } & WithTabId;
  sendInviteMessages: {
    chatId: string;
    userIds: string[];
  } & WithTabId;
  cancelUploadMedia: {
    chatId: string;
    messageId: number;
  };
  pinMessage: {
    chatId: string;
    messageId: number;
    isUnpin: boolean;
    isOneSide?: boolean;
    isSilent?: boolean;
  };
  deleteMessages: {
    messageIds: number[];
    shouldDeleteForAll?: boolean;
    messageList?: MessageList;
  } & WithTabId;
  deleteEphemeralMessage: {
    chatId: string;
    messageId: number;
  };
  markMessageListRead: {
    maxId: number;
  } & WithTabId;
  markMessagesRead: {
    chatId: string;
    messageIds: number[];
  };
  loadMessage: {
    chatId: string;
    messageId: number;
    replyOriginForId?: number;
  };
  loadRichMessage: {
    chatId: string;
    messageId: number;
    isScheduled?: boolean;
  };
  startEditingMessage: {
    messageId: number;
  } & WithTabId;
  loadMessagesById: {
    chatId: string;
    messageIds: number[];
  };
  editMessage: {
    messageList?: MessageList;
    text: string;
    attachments?: ApiAttachment[];
    entities?: ApiMessageEntity[];
    richMessage?: ApiInputRichMessage;
  } & WithTabId;
  deleteHistory: {
    chatId: string;
    shouldDeleteForAll?: boolean;
  } & WithTabId;
  stopActiveEmojiInteraction: {
    id: number;
  } & WithTabId;
  interactWithAnimatedEmoji: {
    emoji: string;
    x: number;
    y: number;
    startSize: number;
    isReversed?: boolean;
  } & WithTabId;
  loadReactors: {
    chatId: string;
    messageId: number;
    reaction?: ApiReaction;
  };
  sendMessageAction: {
    action: ApiSendMessageAction;
    chatId: string;
    threadId: ThreadId;
  };
  loadSeenBy: {
    chatId: string;
    messageId: number;
  };
  openTelegramLink: {
    url: string;
    linkContext?: LinkContext;
  } & WithTabId;
  openChatByUsername: {
    username: string;
    threadId?: ThreadId;
    messageId?: number;
    commentId?: number;
    text?: string;
    timestamp?: number;
    onChatChanged?: CallbackAction;
    linkContext?: LinkContext;
    isDirect?: boolean;
  } & WithTabId;
  setScrollOffset: {
    chatId: string;
    threadId: ThreadId;
    scrollOffset: number;
  } & WithTabId;
  unpinAllMessages: {
    chatId: string;
    threadId: ThreadId;
  };
  setEditingId: {
    messageId?: number;
  } & WithTabId;
  markTypingDraftDone: {
    chatId: string;
    messageId: number;
  };
  editLastMessage: WithTabId | undefined;
  saveDraft: {
    chatId: string;
    threadId: ThreadId;
    text: ApiDraft['text'];
    richMessage?: ApiDraft['richMessage'];
  };
  clearDraft: {
    chatId: string;
    threadId?: ThreadId;
    isLocalOnly?: boolean;
    shouldKeepReply?: boolean;
  };
  loadPinnedMessages: {
    chatId: string;
    threadId: ThreadId;
  };
  toggleMessageWebPage: {
    chatId: string;
    threadId: ThreadId;
    noWebPage?: boolean;
  };
  replyToNextMessage: {
    targetIndexDelta: number;
  } & WithTabId;
  deleteChat: { chatId: string } & WithTabId;
  terminateChat: { chatId: string } & WithTabId;
  revokeChatInvite: { chatId: string; serviceId: string } & WithTabId;
  addChatMemberByPhoneNumber: { chatId: string; phoneNumber: string } & WithTabId;

  // chat creation
  createGroupChat: {
    title: string;
    memberIds: string[];
    photo?: ApiAvatarUpload;
  } & WithTabId;
  resetChatCreation: WithTabId | undefined;

  // ui
  dismissDialog: WithTabId | undefined;
  setNewChatMembersDialogState: {
    newChatMembersProgress?: NewChatMembersProgress;
  } & WithTabId;
  disableHistoryAnimations: WithTabId | undefined;
  setLeftColumnWidth: {
    leftColumnWidth: number;
  };
  resetLeftColumnWidth: undefined;

  copySelectedMessages: ({ shouldNotify?: boolean } & WithTabId) | undefined;
  copyMessagesByIds: {
    request: MessageCopyRequest;
    shouldNotify?: boolean;
    textFormat?: ClipboardTextFormat;
  } & WithTabId;
  openSeenByModal: {
    chatId: string;
    messageId: number;
  } & WithTabId;
  closeSeenByModal: WithTabId | undefined;
  openPrivacySettingsNoticeModal: {
    chatId: string;
    isReadDate: boolean;
  } & WithTabId;
  closePrivacySettingsNoticeModal: WithTabId | undefined;
  closeReactorListModal: WithTabId | undefined;
  openReactorListModal: {
    chatId: string;
    messageId: number;
  } & WithTabId;
  enterMessageSelectMode: ({
    messageId: number;
  } & WithTabId) | undefined;
  toggleMessageSelection: {
    messageId: number;
    groupedId?: string;
    childMessageIds?: number[];
    withShift?: boolean;
  } & WithTabId;
  exitMessageSelectMode: WithTabId | undefined;
  openHistoryCalendar: {
    selectedAt?: number;
  } & WithTabId;
  closeHistoryCalendar: WithTabId | undefined;
  disableContextMenuHint: undefined;
  focusNextReply: WithTabId | undefined;
  focusNextMention: {
    chatId: string;
    threadId?: ThreadId;
  } & WithTabId;
  markMentionsRead: {
    chatId: string;
    messageIds: number[];
  };
  readAllMentions: {
    chatId: string;
    threadId?: ThreadId;
  };

  // poll result
  openPollResults: {
    chatId: string;
    messageId: number;
  } & WithTabId;
  closePollResults: WithTabId | undefined;
  loadPollOptionResults: {
    chat: ApiChat;
    messageId: number;
    option: string;
    offset: string;
    limit: number;
    shouldResetVoters?: boolean;
  } & WithTabId;

  // management
  setEditingExportedInvite: { chatId: string; invite?: ApiExportedInvite } & WithTabId;
  loadExportedChatInvites: {
    chatId: string;
    adminId?: string;
    isRevoked?: boolean;
    limit?: number;
  } & WithTabId;
  editExportedChatInvite: {
    chatId: string;
    link: string;
    isRevoked?: boolean;
    expireDate?: number;
    usageLimit?: number;
    isRequestNeeded?: boolean;
    title?: string;
  } & WithTabId;
  exportChatInvite: {
    chatId: string;
    expireDate?: number;
    usageLimit?: number;
    isRequestNeeded?: boolean;
    title?: string;
  } & WithTabId;
  deleteExportedChatInvite: {
    chatId: string;
    link: string;
  } & WithTabId;
  deleteRevokedExportedChatInvites: {
    chatId: string;
    adminId?: string;
  } & WithTabId;
  setOpenedInviteInfo: { chatId: string; invite?: ApiExportedInvite } & WithTabId;
  loadChatInviteImporters: {
    chatId: string;
    link?: string;
    offsetDate?: number;
    offsetUserId?: string;
    limit?: number;
  } & WithTabId;
  hideChatJoinRequest: {
    chatId: string;
    userId: string;
    isApproved: boolean;
  };
  hideAllChatJoinRequests: {
    chatId: string;
    isApproved: boolean;
    link?: string;
  };
  loadChatInviteRequesters: {
    chatId: string;
    link?: string;
    offsetDate?: number;
    offsetUserId?: string;
    limit?: number;
  } & WithTabId;
  hidePeerSettingsBar: {
    peerId: string;
  };
  toggleManagement: ({
    force?: boolean;
  } & WithTabId) | undefined;
  requestNextManagementScreen: ({
    screen?: ManagementScreens;
  } & WithTabId) | undefined;
  closeManagement: WithTabId | undefined;
  resetManagementError: { chatId: string } & WithTabId;

  setShouldCloseRightColumn: {
    value?: boolean;
  } & WithTabId;
  requestChatUpdate: { chatId: string };
  loadChatJoinRequests: {
    chatId: string;
    offsetDate?: number;
    offsetUserId?: string;
    limit?: number;
  };
  loadTopChats: { messageToNotify?: ApiMessage } | undefined;
  showDialog: {
    data: TabState['dialogs'][number];
  } & WithTabId;
  focusMessage: {
    chatId: string;
    threadId?: ThreadId;
    messageListType?: MessageListType;
    messageId: number;
    noHighlight?: boolean;
    groupedId?: string;
    groupedChatId?: string;
    replyMessageId?: number;
    isResizingContainer?: boolean;
    shouldReplaceHistory?: boolean;
    quote?: string;
    quoteOffset?: number;
    pollOption?: string;
    scrollTargetPosition?: ScrollTargetPosition;
    timestamp?: number;
  } & WithTabId;
  scrollMessageListToBottom: WithTabId | undefined;

  updateDraftReplyInfo: (Partial<ApiInputMessageReplyInfo> | ApiInputEphemeralReplyInfo) & WithTabId;
  resetDraftReplyInfo: {
    chatId: string;
    threadId: ThreadId;
  };
  updateInsertingPeerIdMention: {
    peerId?: string;
  } & WithTabId;

  // Multitab
  destroyConnection: undefined;
  initShared: { force?: boolean } | undefined;
  switchMultitabRole: {
    isMasterTab: boolean;
  } & WithTabId;
  openChatInNewTab: {
    chatId: string;
    threadId?: ThreadId;
  };
  onTabFocusChange: {
    isBlurred: boolean;
  } & WithTabId;

  // Initial
  signOut: { forceInitApi?: boolean } | undefined;
  requestChannelDifference: {
    chatId: string;
  };

  // Misc
  setInstallPrompt: { canInstall: boolean } & WithTabId;
  openLimitReachedModal: { limit: ApiLimitTypeWithModal } & WithTabId;
  closeLimitReachedModal: WithTabId | undefined;
  checkAppVersion: undefined;
  setGlobalSearchClosing: ({
    isClosing?: boolean;
  } & WithTabId) | undefined;

  // Accounts
  openFrozenAccountModal: WithTabId | undefined;
  closeFrozenAccountModal: WithTabId | undefined;
  openDeleteAccountModal: {
    days: number;
  } & WithTabId | undefined;
  closeDeleteAccountModal: WithTabId | undefined;
  openAgeVerificationModal: WithTabId | undefined;
  closeAgeVerificationModal: WithTabId | undefined;
  setAccountTTL: {
    days: number;
  } & WithTabId | undefined;
  loadAccountDaysTtl: undefined;

  // Chats
  loadPeerSettings: {
    peerId: string;
  };
  fetchChat: {
    chatId: string;
  };
  updateChatMutedState: {
    chatId: string;
    mutedUntil: number;
  };
  updateChat: {
    chatId: string;
    title: string;
    about: string;
    photo?: ApiAvatarUpload;
  } & WithTabId;
  openChat: {
    id: string | undefined;
    type?: MessageListType;
    shouldReplaceHistory?: boolean;
    shouldReplaceLast?: boolean;
  } & WithTabId;
  // Used by both openThread & openChat
  processOpenChatOrThread: {
    chatId: string | undefined;
    threadId: ThreadId;
    type?: MessageListType;
    shouldReplaceHistory?: boolean;
    shouldReplaceLast?: boolean;
  } & WithTabId;
  loadFullChat: {
    chatId: string;
    withPhotos?: boolean;
    force?: boolean;
  };
  invalidateFullInfo: {
    peerId: string;
  };
  updateChatPhoto: {
    chatId: string;
    photo: ApiPhoto;
  };
  deleteChatPhoto: {
    chatId: string;
    photo: ApiPhoto;
  };
  openChatWithDraft: {
    chatId?: string;
    threadId?: ThreadId;
    text: ApiFormattedText;
    files?: File[];
    filter?: ApiChatType[];
  } & WithTabId;
  resetOpenChatWithDraft: WithTabId | undefined;
  toggleJoinRequest: {
    chatId: string;
    isEnabled: boolean;
    shouldApplyToInvites?: boolean;
  } & WithTabId;
  changeProfileTab: {
    profileTab: ProfileTabType | undefined;
    shouldScrollTo?: boolean;
  } & WithTabId;

  // Messages
  setEditingDraft: {
    draft?: EditingDraft;
    chatId: string;
    threadId: ThreadId;
    type: MessageListType;
  };
  scheduleForViewsIncrement: {
    chatId: string;
    ids: number[];
  };
  loadMessageViews: {
    chatId: string;
    ids: number[];
    shouldIncrement?: boolean;
  };
  loadFactChecks: {
    chatId: string;
    ids: number[];
  };
  loadOutboxReadDate: {
    chatId: string;
    messageId: number;
  };
  animateUnreadReaction: {
    chatId: string;
    messageIds: number[];
  } & WithTabId;
  sendPollVote: {
    chatId: string;
    messageId: number;
    options: string[];
  };
  appendPollAnswer: {
    chatId: string;
    messageId: number;
    text: string;
  };
  cancelPollVote: {
    chatId: string;
    messageId: number;
  };
  closePoll: {
    chatId: string;
    messageId: number;
  };

  loadExtendedMedia: {
    chatId: string;
    ids: number[];
  };

  // Reactions
  loadAvailableReactions: undefined;
  toggleReaction: {
    chatId: string;
    messageId: number;
    reaction: ApiReaction;
    shouldAddToRecent?: boolean;
  } & WithTabId;

  sendDefaultReaction: {
    chatId: string;
    messageId: number;
  } & WithTabId;

  startActiveReaction: {
    containerId: string;
    reaction: ApiReaction;
  } & WithTabId;
  stopActiveReaction: {
    containerId: string;
    reaction?: ApiReaction;
  } & WithTabId;

  openMessageReactionPicker: {
    chatId: string;
    messageId: number;
    position: IAnchorPosition;
  } & WithTabId;
  openStoryReactionPicker: {
    peerId: string;
    storyId: number;
    position: IAnchorPosition;
    sendAsMessage?: boolean;
  } & WithTabId;
  closeReactionPicker: WithTabId | undefined;

  // Stories
  loadAllStories: undefined;
  loadAllHiddenStories: undefined;
  loadPeerStories: {
    peerId: string;
  };
  loadPeerProfileStories: {
    peerId: string;
    offsetId?: number;
  } & WithTabId;
  loadStoriesArchive: {
    peerId: string;
    offsetId?: number;
  } & WithTabId;
  loadPeerSkippedStories: {
    peerId: string;
  } & WithTabId;
  loadPeerStoriesByIds: {
    peerId: string;
    storyIds: number[];
  };
  viewStory: {
    peerId: string;
    storyId: number;
  } & WithTabId;
  deleteStory: {
    peerId: string;
    storyId: number;
  } & WithTabId;
  toggleStoryInProfile: {
    peerId: string;
    storyId: number;
    isInProfile?: boolean;
  };
  toggleStoryPinnedToTop: {
    peerId: string;
    storyId: number;
  };
  toggleStoryRibbon: {
    isShown: boolean;
    isArchived?: boolean;
  } & WithTabId;
  openStoryViewer: {
    peerId: string;
    storyId?: number;
    isSinglePeer?: boolean;
    isSingleStory?: boolean;
    isPrivate?: boolean;
    isArchive?: boolean;
    origin?: StoryViewerOrigin;
  } & WithTabId;
  openStoryViewerByUsername: {
    username: string;
    storyId: number;
    origin?: StoryViewerOrigin;
  } & WithTabId;
  openPreviousStory: WithTabId | undefined;
  openNextStory: WithTabId | undefined;
  setStoryViewerMuted: {
    isMuted: boolean;
  } & WithTabId;
  closeStoryViewer: WithTabId | undefined;
  loadStoryViews: {
    peerId: string;
    storyId: number;
  };
  loadStoryViewList: ({
    peerId: string;
    storyId: number;
    offset?: string;
    query?: string;
    limit?: number;
    areJustContacts?: true;
    areReactionsFirst?: true;
  }) & WithTabId;
  clearStoryViews: {
    isLoading?: boolean;
  } & WithTabId;
  updateStoryView: {
    userId: string;
    isUserBlocked?: boolean;
    areStoriesBlocked?: boolean;
  } & WithTabId;
  openStoryViewModal: {
    storyId: number;
  } & WithTabId;
  closeStoryViewModal: WithTabId | undefined;
  copyStoryLink: {
    peerId: string;
    storyId: number;
  } & WithTabId;
  openStoryPrivacyEditor: WithTabId | undefined;
  closeStoryPrivacyEditor: WithTabId | undefined;
  editStoryPrivacy: {
    peerId: string;
    storyId: number;
    privacy: ApiPrivacySettings;
  };
  toggleStoriesHidden: {
    peerId: string;
    isHidden: boolean;
  };
  sendStoryReaction: {
    peerId: string;
    storyId: number;
    containerId: string;
    reaction?: ApiReaction;
    shouldAddToRecent?: boolean;
  } & WithTabId;
  openStoryComposer: WithTabId | undefined;
  closeStoryComposer: WithTabId | undefined;
  sendStory: {
    story: ApiNewStory;
    listIds: string[];
    groupIds: string[];
  } & WithTabId;
  loadStoryDistributionLists: undefined;
  saveStoryDistributionList: {
    list: Omit<ApiStoryDistributionList, 'id'> & { id?: string };
  };
  deleteStoryDistributionList: {
    id: string;
  };
  loadStorySettings: undefined;
  updateStorySettings: Partial<ApiStorySettings>;
  loadCallLog: undefined;
  markCallLogSeen: undefined;
  loadNotificationProfiles: undefined;
  saveNotificationProfile: {
    profile: Omit<ApiNotificationProfile, 'id'> & { id?: string };
  };
  deleteNotificationProfile: {
    id: string;
  };
  // Turns a profile on by hand, until `endsAt` in seconds if given; without an id turns profiles off by hand
  setNotificationProfileActive: {
    id?: string;
    endsAt?: number;
  };
  clearCallLog: WithTabId | undefined;
  loadStoryAlbums: {
    peerId: string;
  };
  selectStoryAlbum: {
    peerId: string;
    albumId?: number;
  } & WithTabId;
  loadAlbumStories: {
    peerId: string;
    albumId: number;
    offsetId?: number;
  };
  resetSelectedStoryAlbum: WithTabId | undefined;

  // Media Viewer & Audio Player
  openMediaViewer: {
    chatId?: string;
    threadId?: ThreadId;
    messageId?: number;
    standaloneMedia?: MediaViewerMedia[];
    pageMedia?: MediaViewerPageMedia;
    mediaIndex?: number;
    isAvatarView?: boolean;
    origin: MediaViewerOrigin;
    withDynamicLoading?: boolean;
    timestamp?: number;
    viewOnceMedia?: { hash: string; blobUrl: string };
  } & WithTabId;
  closeMediaViewer: ({
    shouldLandInMediaEditor?: boolean;
  } & WithTabId) | undefined;
  updateLastPlaybackTimestamp: {
    chatId: string;
    messageId: number;
    timestamp?: number;
  };
  setMediaViewerVolume: {
    volume: number;
  } & WithTabId;
  setMediaViewerPlaybackRate: {
    playbackRate: number;
  } & WithTabId;
  setMediaViewerMuted: {
    isMuted: boolean;
  } & WithTabId;
  setMediaViewerHidden: {
    isHidden: boolean;
  } & WithTabId;
  openMediaFromTimestamp: {
    chatId: string;
    messageId: number;
    threadId?: ThreadId;
    timestamp: number;
  } & WithTabId;
  openAudioPlayer: {
    item?: PlaybackItemRef;
    source?: PlaybackSource;
    volume?: number;
    playbackRate?: number;
    isMuted?: boolean;
    timestamp?: number;
  } & WithTabId;
  closeAudioPlayer: WithTabId | undefined;
  handleAudioPlaybackEnded: {
    withAutoAdvance?: boolean;
  } & WithTabId;
  setAudioPlayerVolume: {
    volume: number;
  } & WithTabId;
  setAudioPlayerPlaybackRate: {
    playbackRate: number;
    isPlaybackRateActive?: boolean;
  } & WithTabId;
  setAudioPlayerMuted: {
    isMuted: boolean;
  } & WithTabId;
  setAudioPlaybackSource: {
    source: PlaybackSource;
  } & WithTabId;
  setRoundVideoMode: {
    mode?: RoundVideoMode;
  } & WithTabId;
  playNextTrack: {
    isAuto?: boolean;
  } & WithTabId;
  playPreviousTrack: WithTabId | undefined;
  setAudioPlayerRepeatMode: {
    repeatMode: RepeatMode;
  } & WithTabId;
  setAudioPlayerOrderMode: {
    orderMode: OrderMode;
  } & WithTabId;
  openAudioPlaylistModal: WithTabId | undefined;
  closeAudioPlaylistModal: WithTabId | undefined;
  loadShufflePlaylist: WithTabId | undefined;
  loadSavedMusicIds: undefined;
  toggleMusicInProfile: { audio: ApiAudio } & WithTabId;
  reorderSavedMusic: { audioId: string; afterAudioId?: string } & WithTabId;

  // Downloads
  downloadSelectedMessages: WithTabId | undefined;
  downloadMedia: {
    media: DownloadableMedia;
    originMessage?: ApiMessage;
  } & WithTabId;
  cancelMediaDownload: {
    media: DownloadableMedia;
  } & WithTabId;
  cancelMediaHashDownloads: {
    mediaHashes: string[];
  } & WithTabId;
  updateSavedFiles: {
    added?: string[];
    removed?: string[];
  } & WithTabId;
  openSavedFile: {
    key: string;
  } & WithTabId;
  showSavedFileInFolder: {
    key: string;
  } & WithTabId;

  // Users
  loadNearestCountry: undefined;
  loadContactList: undefined;

  loadCurrentUser: undefined;
  updateProfile: {
    photo?: ApiAvatarUpload;
    shouldRemovePhoto?: true;
    firstName: string;
    lastName?: string;
    bio?: string;
  } & WithTabId;
  reserveUsername: {
    nickname: string;
    discriminator?: string;
  } & WithTabId;
  confirmUsername: WithTabId | undefined;
  deleteUsername: WithTabId | undefined;
  loadUsernameLink: WithTabId | undefined;
  resetUsernameLink: WithTabId | undefined;
  resetUsernameEdit: WithTabId | undefined;
  openChatByUsernameLink: {
    url: string;
  } & WithTabId;
  openChatByAci: {
    aci: string;
  } & WithTabId;
  loadPhoneNumberPrivacy: undefined;
  updatePhoneNumberPrivacy: {
    isShared?: boolean;
    isDiscoverable?: boolean;
  } & WithTabId;
  openSafetyNumberModal: {
    userId: string;
  } & WithTabId;
  closeSafetyNumberModal: WithTabId | undefined;
  toggleSafetyNumberVerified: WithTabId | undefined;
  checkKeyTransparency: WithTabId | undefined;
  cancelKeyTransparencyCheck: WithTabId | undefined;
  loadKeyTransparencySelfStatus: undefined;
  runKeyTransparencySelfCheck: undefined;
  openSafetyNumberChangeModal: {
    chatId: string;
    messageId: number;
    userIds: string[];
  } & WithTabId;
  closeSafetyNumberChangeModal: WithTabId | undefined;
  sendMessageAnyway: WithTabId | undefined;
  openMessageDetailsModal: {
    chatId: string;
    messageId: number;
  } & WithTabId;
  closeMessageDetailsModal: WithTabId | undefined;
  loadMessageDetails: {
    chatId: string;
    messageId: number;
  } & WithTabId;
  resendMessage: {
    chatId: string;
    messageId: number;
  } & WithTabId;
  // Settings open it always; the main screen opens it for a recovery key that the user did not confirm yet
  openRecoveryKeyModal: ({ shouldSkipConfirmed?: boolean } & WithTabId) | undefined;
  closeRecoveryKeyModal: WithTabId | undefined;
  confirmRecoveryKeySaved: WithTabId | undefined;
  loadPersonalChannels: undefined;
  updateBirthday: {
    birthday?: ApiBirthday;
  };
  suggestBirthday: {
    userId: string;
    birthday: ApiBirthday;
  };
  openBirthdaySetupModal: {
    currentBirthday?: ApiBirthday;
    suggestForUserId?: string;
    isFromSuggestion?: boolean;
  } & WithTabId;
  closeBirthdaySetupModal: WithTabId | undefined;
  deleteContact: { userId: string };
  loadUser: { userId: string };
  loadCommonChats: {
    userId: string;
  };
  settlePendingPlaylistStep: {
    shouldContinue?: boolean;
  } & WithTabId;
  loadSavedMusic: {
    userId: string;
  } & WithTabId;
  reportSpam: { chatId: string } & WithTabId;
  loadFullUser: { userId: string; withPhotos?: boolean };
  openAddContactDialog: { userId?: string } & WithTabId;
  openNewContactDialog: WithTabId | undefined;
  closeNewContactDialog: WithTabId | undefined;
  importContact: {
    phoneNumber: string;
    firstName: string;
    lastName?: string;
  } & WithTabId;
  updateContact: {
    userId: string;
    firstName: string;
    lastName?: string;
    shouldSharePhoneNumber?: boolean;
    note?: ApiFormattedText;
  } & WithTabId;
  updateContactNote: {
    userId: string;
    note: ApiFormattedText;
  } & WithTabId;
  openDisableSharingAboutModal: {
    userId: string;
  } & WithTabId;
  closeDisableSharingAboutModal: WithTabId | undefined;
  openRankModal: {
    chatId: string;
    userId: string;
    isAdmin?: boolean;
    isOwner?: boolean;
    rank?: string;
  } & WithTabId;
  closeRankModal: WithTabId | undefined;
  openEditRankModal: {
    chatId: string;
    userId: string;
    isAdmin?: boolean;
    isOwner?: boolean;
    rank?: string;
  } & WithTabId;
  closeEditRankModal: WithTabId | undefined;
  loadMoreProfilePhotos: {
    peerId: string;
    isPreload?: boolean;
    shouldInvalidateCache?: boolean;
  };
  deleteProfilePhoto: {
    photo: ApiPhoto;
  };
  updateProfilePhoto: {
    photo: ApiPhoto;
    isFallback?: boolean;
  };
  // Composer
  setShouldPreventComposerAnimation: {
    shouldPreventComposerAnimation: boolean;
  } & WithTabId;
  setIsRichInputExpanded: {
    isRichInputExpanded?: boolean;
  } & WithTabId;
  requestRichInputMedia: NonNullable<TabState['requestedRichInputMedia']> & WithTabId;
  resetRichInputMediaRequest: WithTabId | undefined;
  changeRichMediaUploadBlocking: {
    delta: 1 | -1;
  } & WithTabId;

  // Replies
  openReplyMenu: {
    fromChatId: string;
    messageId?: number;
    quoteText?: ApiFormattedText;
    quoteRich?: ApiRichText[];
    quoteOffset?: number;
  } & WithTabId;

  // Forwards
  openForwardMenu: {
    fromChatId: string;
    messageIds?: number[];
    storyId?: number;
    audioItem?: PlaybackItemRef;
    groupedId?: string;
    withMyScore?: boolean;
  } & WithTabId;
  openForwardMenuForSelectedMessages: WithTabId | undefined;
  setForwardChat: {
    chatId: string;
  } & WithTabId;
  openChatWithReplyInDraft: {
    chatId: string;
  } & WithTabId;
  forwardMessages: {
    isSilent?: boolean;
    scheduledAt?: number;
  } & WithTabId;
  setForwardNoAuthors: {
    noAuthors: boolean;
  } & WithTabId;
  setForwardNoCaptions: {
    noCaptions: boolean;
  } & WithTabId;
  exitForwardMode: WithTabId | undefined;
  changeRecipient: WithTabId | undefined;
  forwardToMultipleChats: {
    targets: ForwardTarget[];
    comment?: string;
  } & WithTabId;
  forwardToSavedMessages: {
    scheduledAt?: number;
  } & WithTabId;
  forwardStory: {
    toChatId: string;
  } & WithTabId;
  forwardAudio: { toChatId: string; toThreadId?: ThreadId } & WithTabId;
  sendAudioToSavedMessages: { audio: ApiAudio } & WithTabId;

  // GIFs
  loadSavedGifs: undefined;

  // Stickers
  loadStickers: {
    stickerSetInfo: ApiStickerSetInfo;
  };
  loadAnimatedEmojis: undefined;
  loadGreetingStickers: undefined;
  loadGenericEmojiEffects: undefined;
  loadBirthdayNumbersStickers: undefined;
  loadRestrictedEmojiStickers: undefined;

  addRecentSticker: {
    sticker: ApiSticker;
  };

  removeRecentSticker: {
    sticker: ApiSticker;
  };

  clearRecentStickers: undefined;

  loadStickerSets: undefined;
  loadAddedStickers: undefined;
  loadRecentStickers: undefined;
  loadFavoriteStickers: undefined;
  loadFeaturedStickers: undefined;
  hideTrendingStickers: undefined;
  loadDiceStickers: undefined;

  reorderStickerSets: {
    isCustomEmoji?: boolean;
    order: string[];
  };

  addNewStickerSet: {
    stickerSet: ApiStickerSet;
  };

  openStickerSet: {
    stickerSetInfo: ApiStickerSetInfo;
    shouldIgnoreCache?: boolean;
  } & WithTabId;
  closeStickerSetModal: WithTabId | undefined;

  loadStickersForEmoji: {
    emoji: string;
  };
  clearStickersForEmoji: undefined;

  loadCustomEmojiForEmoji: {
    emoji: string;
  };
  clearCustomEmojiForEmoji: undefined;

  addRecentEmoji: {
    emoji: string;
  };

  loadCustomEmojis: {
    ids: string[];
    ignoreCache?: boolean;
  };
  updateLastRenderedCustomEmojis: {
    ids: string[];
  };
  openCustomEmojiSets: {
    setIds: string[];
  } & WithTabId;
  closeCustomEmojiSets: WithTabId | undefined;
  addRecentCustomEmoji: {
    documentId: string;
  };
  clearRecentCustomEmoji: undefined;
  loadFeaturedEmojiStickers: undefined;
  loadDefaultStatusIcons: undefined;
  loadRecentEmojiStatuses: undefined;

  loadTopPeers: {
    category: ApiTopPeerCategory;
    force?: boolean;
  };
  removeTopPeer: {
    category: ApiTopPeerCategory;
    peerId: string;
  };
  bumpTopPeerRating: {
    category: ApiTopPeerCategory;
    peerId: string;
    date?: number;
  };

  clickRichButton: {
    chatId?: string;
    messageId?: number;
    threadId?: ThreadId;
    action: ApiInlineButtonAction;
  } & WithTabId;

  openPollModal: {
    chatId: string;
    threadId?: ThreadId;
    messageListType: MessageListType;
  } & WithTabId;
  closePollModal: WithTabId | undefined;
  openMusicPicker: {
    chatId: string;
    threadId?: ThreadId;
    messageListType: MessageListType;
    shouldInsertToRichInput?: boolean;
  } & WithTabId;
  closeMusicPicker: WithTabId | undefined;
  loadMusicPickerShared: WithTabId | undefined;
  requestConfetti: (ConfettiParams & WithTabId) | WithTabId;
  requestWave: {
    startX: number;
    startY: number;
  } & WithTabId;

  updateAttachmentSettings: {
    defaultAttachmentCompression?: AttachmentCompression;
    shouldCompress?: boolean;
    shouldSendGrouped?: boolean;
    isInvertedMedia?: true;
    webPageMediaSize?: WebPageMediaSize;
    shouldSendInHighQuality?: boolean;
  };
  updateMediaEditorSettings: MediaEditorSettings;
  updateShouldSaveAttachmentsCompression: { shouldSave: boolean } & WithTabId;
  applyDefaultAttachmentsCompression: undefined;

  updateArchiveSettings: {
    isMinimized?: boolean;
    isHidden?: boolean;
  };

  openUrl: {
    url: string;
    shouldSkipModal?: boolean;
    ignoreDeepLinks?: boolean;
    linkContext?: LinkContext;
  } & WithTabId;
  toggleSafeLinkModal: {
    url?: string;
  } & WithTabId;
  showNotification: Omit<ApiNotification, 'localId'> & { localId?: string } & WithTabId;
  showAllowedMessageTypesNotification: {
    chatId: string;
  } & WithTabId;
  dismissNotification: { localId: string } & WithTabId;

  updatePageTitle: WithTabId | undefined;
  closeInviteViaLinkModal: WithTabId | undefined;

  openOneTimeMediaModal: TabState['oneTimeMediaModal'] & WithTabId;
  closeOneTimeMediaModal: WithTabId | undefined;

  openQrCodeModal: {
    peerId: string;
  } & WithTabId;
  closeQrCodeModal: WithTabId | undefined;

  // Passcode
  setPasscode: { passcode: string } & WithTabId;
  clearPasscode: undefined;
  lockScreen: undefined;
  unlockScreen: { passcode: string };
  unlockScreenWithPasskey: { isConditional?: boolean } | undefined;
  setPasscodeKeepBackground: { shouldKeep: boolean };
  setPasscodeAutolockDuration: { duration?: number };
  setupUnlockPasskey: { passcode: string } & WithTabId;
  removeUnlockPasskey: { passcode: string } & WithTabId;
  signOutAllAccounts: undefined;
  onPasscodeStateChangedRemotely: { dek?: ArrayBuffer; generation?: string };
  onPasscodeSessionsChanged: { generation: string };
  softSignIn: undefined;
  resetInvalidUnlockAttempts: { timeoutUntil: number };
  setPasscodeError: { errorKey: RegularLangFnParameters };
  clearPasscodeError: undefined;
  // Settings
  updateShouldEnableDebugLog: undefined;
  loadConfig: undefined;
  loadAppConfig: {
    hash: number;
  } | undefined;
  loadPromoData: undefined;
  dismissSuggestion: {
    suggestion: string;
  } & WithTabId;
  loadPeerColors: undefined;
  openLeftColumnContent: {
    contentKey?: LeftColumnContent;
  } & WithTabId;
  openSettingsScreen: {
    screen?: SettingsScreens;
    highlight?: SettingsHighlight;
  } & WithTabId;
  loadNestedSettingsData: undefined;
  openSettingsLink: {
    path: string;
  } & WithTabId;
  clearSettingsHighlight: WithTabId | undefined;
  addRecentlyFoundSettingId: {
    id: string;
  };
  removeRecentlyFoundSettingId: {
    id: string;
  };
  requestNextFoldersAction: {
    foldersAction?: ReducerAction<FoldersActions>;
  } & WithTabId;
  sortChatFolders: { folderIds: number[] };
  closeDeleteChatFolderModal: WithTabId | undefined;
  openDeleteChatFolderModal: {
    folderId: number;
  } & WithTabId;
  openEditChatFolder: {
    folderId: number;
  } & WithTabId;
  loadDefaultHistoryTtl: undefined;
  setDefaultHistoryTtl: { period: number };
  loadGlobalPrivacySettings: undefined;
  updateGlobalPrivacySettings: {
    shouldArchiveAndMuteNewNonContact?: boolean;
    shouldHideReadMarks?: boolean;
  };

  openAutoDeleteTimerModal: {
    chatId: string;
  } & WithTabId;
  closeAutoDeleteTimerModal: WithTabId | undefined;

  openQuickChatPicker: WithTabId | undefined;
  closeQuickChatPicker: WithTabId | undefined;

  openQuickPreview: {
    id: string;
  } & WithTabId;
  closeQuickPreview: WithTabId | undefined;

  openDeleteMessageModal: ({
    chatId: string;
    messageIds: number[];
    isSchedule?: boolean;
    onConfirm?: NoneToVoidFunction;
  } & WithTabId);
  closeDeleteMessageModal: WithTabId | undefined;

  openDeleteMemberModal: ({
    chatId: string;
    peerId: string;
  } & WithTabId);
  closeDeleteMemberModal: WithTabId | undefined;

  saveVoiceWaveform: {
    chatId: string;
    messageId: number;
    waveform: number[];
  };

  setEmojiStatus: {
    emojiStatus: ApiEmojiStatus;
  } & WithTabId;

  // Forums

  uploadContactProfilePhoto: {
    userId: string;
    photo?: ApiAvatarUpload;
    isSuggest?: boolean;
  } & WithTabId;

  requestMessageMediaEditor: {
    chatId: string;
    messageId: number;
    videoTime?: number;
  } & WithTabId;
  resetMessageMediaEditorRequest: WithTabId | undefined;
}

export interface RequiredActionPayloads {
  apiUpdate: ApiUpdate;
}

type Values<T> = T[keyof T];
export type CallbackAction = Values<{
  [ActionName in keyof (ActionPayloads)]: {
    action: ActionName;
    payload: (ActionPayloads)[ActionName];
  }
}>;
