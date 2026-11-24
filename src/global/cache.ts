import { getIsHeavyAnimating, onFullyIdle } from '../lib/teact/teact';
import { addCallback, removeCallback } from '../lib/teact/teactn';

import type {
  ApiAvailableReaction,
  ApiDocument,
  ApiMessage,
  ApiPhoto,
  ApiVideo,
} from '../api/types';
import type {
  IThemeSettings, MessageList, PerformanceType, ThemeKey, ThreadId,
} from '../types';
import type { ActionReturnType, GlobalState, SharedState } from './types';
import { ApiMessageEntityTypes, MAIN_THREAD_ID } from '../api/types';

import {
  ALL_FOLDER_ID,
  ARCHIVED_FOLDER_ID,
  DEBUG,
  EPHEMERAL_MESSAGE_TTL_SECONDS,
  FOLDERS_POSITION_DEFAULT,
  GLOBAL_STATE_CACHE_ARCHIVED_CHAT_LIST_LIMIT,
  GLOBAL_STATE_CACHE_CHAT_LIST_LIMIT,
  GLOBAL_STATE_CACHE_CUSTOM_EMOJI_LIMIT,
  GLOBAL_STATE_CACHE_DISABLED,
  GLOBAL_STATE_CACHE_PREFIX,
  GLOBAL_STATE_CACHE_USER_LIST_LIMIT,
  IS_SCREEN_LOCKED_CACHE_KEY,
  SHARED_STATE_CACHE_KEY,
} from '../config';
import { buildColor, serializeColor } from '../lib/color';
import { MAIN_IDB_STORE } from '../util/browser/idb';
import { isUserId } from '../util/entities/ids';
import { getOrderedIds } from '../util/folderManager';
import {
  compact, pick, pickTruthy, unique,
} from '../util/iteratees';
import { ACCOUNT_SLOT, getGlobalStateCacheKey, GLOBAL_STATE_CACHE_KEY } from '../util/multiaccount';
import { parseJsonWithBigInt, stringifyJsonWithBigInt } from '../util/numbers';
import { getDek, writeGlobalsVaultForSlot } from '../util/passcode';
import { onBeforeUnload, throttle } from '../util/schedulers';
import { getServerTime } from '../util/serverTime';
import { hasStoredSession } from '../util/sessions';
import { getSystemTheme } from '../util/systemTheme';
import { getDefaultPatternColor, getThemeWallpaper } from '../util/wallpaper';
import { migrateLegacyWallpaperBlobs, prefetchWallpaperUrl } from '../util/wallpaper/storage';
import { selectSharedSettings } from './selectors/sharedState';
import { addActionHandler, getGlobal } from './index';
import { INITIAL_GLOBAL_STATE, SHARED_STATE_CACHE_VERSION } from './initialState';
import { clearGlobalForLockScreen, updatePasscodeSettings } from './reducers';
import {
  selectChatLastMessageId,
  selectChatMessages,
  selectCurrentMessageList,
  selectFullWebPageFromMessage,
  selectViewportIds,
  selectVisibleUsers,
} from './selectors';

import { getIsMobile } from '../hooks/useAppLayout';

const UPDATE_THROTTLE = 5000;

// Message and message content fields of removed Telegram features
const REMOVED_MESSAGE_FIELDS = [
  'inlineButtons', 'keyboardButtons', 'keyboardPlaceholder', 'isKeyboardSingleUse', 'isKeyboardSelective',
  'isKeyboardFullHeight', 'shouldHideKeyboardButtons', 'isHideKeyboardSelective', 'viaBotId', 'guestChatViaId',
];
const REMOVED_MESSAGE_CONTENT_FIELDS = ['game', 'location', 'widget'];

// `patternColor` values the cache migration recognizes as defaults and replaces with the
// wallpaper-derived ones
const LEGACY_DEFAULT_PATTERN_COLOR = '#4A8E3A8C';
const LEGACY_DARK_THEME_PATTERN_COLOR = '#48576166';

// Bump `SHARED_STATE_CACHE_VERSION` in `initialState.ts` alongside the newest step here
const SHARED_STATE_PATTERN_COLORS_CACHE_VERSION = 3;
const SHARED_STATE_V1_LIGHT_PATTERN_COLOR = '#77854b66';
const SHARED_STATE_V1_DARK_PATTERN_COLOR = '#27308a66';
const SHARED_STATE_HEX_PATTERN_COLORS_CACHE_VERSION = 5;
const SHARED_STATE_REMOVED_SETTINGS_CACHE_VERSION = 6;
const SHARED_STATE_REMOVED_TRANSPORT_SETTINGS_CACHE_VERSION = 7;
const updateCacheThrottled = throttle(() => onFullyIdle(() => updateCache()), UPDATE_THROTTLE, false);
const updateCacheForced = () => updateCache(true);

let isCaching = false;
let isRemovingCache = false;
let cacheUpdateSuspensionTimestamp = 0;
let unsubscribeFromBeforeUnload: NoneToVoidFunction | undefined;

export function cacheGlobal(global: GlobalState) {
  return cacheGlobalForSlot(ACCOUNT_SLOT, global);
}

export function cacheGlobalForSlot(slot: number | undefined, global: GlobalState) {
  return MAIN_IDB_STORE.set(getGlobalStateCacheKey(slot), reduceGlobal(global));
}

export function cacheSharedState(state: SharedState) {
  return MAIN_IDB_STORE.set(SHARED_STATE_CACHE_KEY, state);
}

export function loadCachedGlobal() {
  return loadCachedGlobalForSlot(ACCOUNT_SLOT);
}

export function loadCachedGlobalForSlot(slot: number | undefined) {
  return readCachedState<GlobalState>(getGlobalStateCacheKey(slot));
}

export function loadCachedSharedState() {
  return readCachedState<SharedState>(SHARED_STATE_CACHE_KEY);
}

async function readCachedState<T>(key: string): Promise<T | undefined> {
  try {
    return await MAIN_IDB_STORE.get<T>(key);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'NotReadableError') {
      // A missing backing file invalidates only this disposable cache record.
      // Cleanup failure must not prevent startup from using fresh state.
      await MAIN_IDB_STORE.del(key).catch(() => undefined);
      return undefined;
    }

    throw err;
  }
}

export function removeGlobalFromCache() {
  return MAIN_IDB_STORE.del(GLOBAL_STATE_CACHE_KEY);
}

export async function removeAllGlobalCaches() {
  Object.keys(localStorage).filter(isGlobalStateCacheKey).forEach((cacheKey) => localStorage.removeItem(cacheKey));
  const cacheKeys = (await MAIN_IDB_STORE.keys()).filter(
    (cacheKey): cacheKey is string => typeof cacheKey === 'string' && isGlobalStateCacheKey(cacheKey),
  );
  await MAIN_IDB_STORE.delMany(cacheKeys);
}

function isGlobalStateCacheKey(cacheKey: string) {
  return cacheKey === GLOBAL_STATE_CACHE_PREFIX || cacheKey.startsWith(`${GLOBAL_STATE_CACHE_PREFIX}_`);
}

export function removeSharedStateFromCache() {
  return MAIN_IDB_STORE.del(SHARED_STATE_CACHE_KEY);
}

export function initCache() {
  if (GLOBAL_STATE_CACHE_DISABLED) {
    return;
  }

  const resetCache = () => {
    isRemovingCache = true;
    removeGlobalFromCache().finally(() => {
      isRemovingCache = false;
      if (!isCaching) {
        return;
      }

      clearCaching();
    });
  };

  addActionHandler('saveSession', (): ActionReturnType => {
    if (isCaching) {
      return;
    }

    setupCaching();
    updateCacheForced();
  });

  addActionHandler('reset', resetCache);
}

export async function loadCache(initialState: GlobalState): Promise<GlobalState | undefined> {
  if (GLOBAL_STATE_CACHE_DISABLED) {
    return undefined;
  }

  const cache = await readCache(initialState);

  if (cache.passcode.hasPasscode || hasStoredSession()) {
    // Start resolving the wallpaper early without delaying the initial render
    void prefetchCurrentWallpaperUrl(cache);

    return cache;
  } else {
    clearCaching();

    return undefined;
  }
}

export function setupCaching() {
  if (isCaching) return;

  isCaching = true;
  unsubscribeFromBeforeUnload = onBeforeUnload(updateCacheForced, true);
  window.addEventListener('blur', updateCacheForced);
  addCallback(updateCacheThrottled);
}

export function clearCaching() {
  isCaching = false;
  removeCallback(updateCacheThrottled);
  window.removeEventListener('blur', updateCacheForced);
  if (unsubscribeFromBeforeUnload) {
    unsubscribeFromBeforeUnload();
  }
}

async function readCache(initialState: GlobalState): Promise<GlobalState> {
  if (DEBUG) {
    // eslint-disable-next-line no-console
    console.time('global-state-cache-read');
  }

  const json = localStorage.getItem(GLOBAL_STATE_CACHE_KEY);
  const cachedFromLocalStorage = json ? parseJsonWithBigInt<GlobalState>(json) : undefined;
  if (cachedFromLocalStorage) localStorage.removeItem(GLOBAL_STATE_CACHE_KEY);

  let cached = cachedFromLocalStorage || await loadCachedGlobal();
  const cachedSharedState = await loadCachedSharedState();
  const cachedAccountThemes = (cached as any)?.settings?.themes as (
    Partial<Record<ThemeKey, IThemeSettings>> | undefined
  );
  const cachedSharedThemes = cachedSharedState?.settings?.themes;
  const shouldMigrateAccountThemes = Boolean(cachedAccountThemes && !cachedSharedThemes);

  if (DEBUG) {
    // eslint-disable-next-line no-console
    console.timeEnd('global-state-cache-read');
  }

  if (cached) {
    migrateCache(cached, initialState);
  }

  const sharedState = migrateSharedCache(
    cachedSharedState,
    cached?.sharedState.settings.themes,
    initialState.sharedState,
  );

  if (cached) {
    cached = {
      ...cached,
      sharedState,
    };
  }

  if (shouldMigrateAccountThemes) {
    await migrateLegacyWallpaperBlobs(cachedAccountThemes!);
  }

  const newState: GlobalState = {
    ...initialState,
    ...cached,
    sharedState: {
      ...initialState.sharedState,
      ...sharedState,
      ...cached?.sharedState, // Allow migration to override shared state
      settings: {
        ...initialState.sharedState.settings,
        ...sharedState.settings,
        ...cached?.sharedState.settings,
      },
    },
  };

  return newState;
}

export function migrateSharedCache(
  cached: SharedState | undefined,
  fallbackThemes: Partial<Record<ThemeKey, IThemeSettings>> | undefined,
  initialState: SharedState,
): SharedState {
  const cacheVersion = cached?.cacheVersion ?? 0;
  const cachedSettings = cached?.settings;
  // Web K writes only the settings it shares (the proxy servers) when Web A has saved none yet
  const settings = cachedSettings ? { ...initialState.settings, ...cachedSettings } : initialState.settings;
  let migrated = cached || initialState;

  if (cacheVersion < SHARED_STATE_CACHE_VERSION) {
    const { messageBlur, snapEffect, ...performance } = settings.performance as PerformanceType & {
      messageBlur?: boolean;
      snapEffect?: boolean;
    };

    migrated = {
      ...migrated,
      cacheVersion: SHARED_STATE_CACHE_VERSION,
      settings: {
        ...settings,
        performance,
        themes: cachedSettings?.themes
          || (fallbackThemes ? cloneThemeSettings(fallbackThemes) : initialState.settings.themes),
      },
    };
  }

  if (cacheVersion < SHARED_STATE_PATTERN_COLORS_CACHE_VERSION) {
    const themes = cloneThemeSettings(migrated.settings.themes);
    if (themes.light?.patternColor === SHARED_STATE_V1_LIGHT_PATTERN_COLOR) {
      themes.light.patternColor = getDefaultPatternColor('light');
    }

    if (themes.dark?.patternColor === SHARED_STATE_V1_DARK_PATTERN_COLOR) {
      themes.dark.patternColor = getDefaultPatternColor('dark');
    }

    migrated = {
      ...migrated,
      settings: {
        ...migrated.settings,
        themes,
      },
    };
  }

  if (cacheVersion < SHARED_STATE_HEX_PATTERN_COLORS_CACHE_VERSION) {
    // Older versions saved `patternColor` as `hsla(...)`, while the wallpaper helpers expect hex
    const themes = cloneThemeSettings(migrated.settings.themes);
    (['light', 'dark'] as const).forEach((theme) => {
      const patternColor = themes[theme]?.patternColor;
      if (!patternColor || patternColor.startsWith('#')) return;

      try {
        themes[theme]!.patternColor = serializeColor(
          buildColor(patternColor), { format: 'hex', collapse: false, alpha: true },
        );
      } catch {
        themes[theme]!.patternColor = getDefaultPatternColor(theme);
      }
    });

    migrated = {
      ...migrated,
      settings: {
        ...migrated.settings,
        themes,
      },
    };
  }

  if (cacheVersion < SHARED_STATE_REMOVED_SETTINGS_CACHE_VERSION) {
    // Settings of the removed Instant View and browser tabs
    const {
      instantViewFontSizeAdjust, shouldSkipBrowserCloseConfirmation, ...settingsWithoutRemoved
    } = migrated.settings as AnyLiteral;

    migrated = {
      ...migrated,
      settings: settingsWithoutRemoved as SharedState['settings'],
    };
  }

  if (cacheVersion < SHARED_STATE_REMOVED_TRANSPORT_SETTINGS_CACHE_VERSION) {
    // Settings of the removed Telegram HTTP transport and exported senders
    const {
      shouldAllowHttpTransport, shouldForceHttpTransport, shouldDebugExportedSenders, ...settingsWithoutRemoved
    } = migrated.settings as AnyLiteral;

    migrated = {
      ...migrated,
      settings: settingsWithoutRemoved as SharedState['settings'],
    };
  }

  return migrated;
}

function prefetchCurrentWallpaperUrl(global: GlobalState) {
  const { theme, themes, shouldUseSystemTheme } = selectSharedSettings(global);
  const currentTheme = shouldUseSystemTheme ? getSystemTheme() : theme;
  const settings = themes[currentTheme];
  const wallpaper = getThemeWallpaper(settings);
  return prefetchWallpaperUrl(settings?.background ?? (wallpaper?.document ? wallpaper.slug : undefined));
}

export function migrateCache(cached: GlobalState, initialState: GlobalState) {
  try {
    unsafeMigrateCache(cached, initialState);
    pruneExpiredEphemeralMessages(cached);
    clearCachedDraftLocalFlags(cached);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
  }
}

function pruneExpiredEphemeralMessages(cached: GlobalState) {
  const serverTime = getServerTime();
  Object.values(cached.messages.byChatId).forEach(({ ephemeralById }) => {
    Object.values(ephemeralById).forEach((message) => {
      if (message.anchorMsgId || message.date + EPHEMERAL_MESSAGE_TTL_SECONDS <= serverTime) {
        delete ephemeralById[message.id];
      }
    });
  });
}

function unsafeMigrateCache(cached: GlobalState, initialState: GlobalState) {
  const untypedCached = cached as any;
  // Push registrations are reconciled against the shared subscription registry
  delete untypedCached.push;
  removeTelegramOnlyFields(untypedCached);

  // Older caches can hold message widget storage and bot state
  delete untypedCached.messageWidgetStorage;
  delete untypedCached.attachMenu;
  delete untypedCached.trustedBotIds;
  delete untypedCached.users.botAppPermissionsById;
  delete untypedCached.settings.botVerificationShownPeerIds;
  Object.values(cached.chats.fullInfoById).forEach((fullInfo) => {
    fullInfo.isCache = true;
  });

  Object.values(cached.messages.byChatId).forEach((messageStore) => {
    messageStore.ephemeralById ||= {};
    messageStore.anchoredById = {};
  });

  // Pre-fill settings with defaults
  cached.settings.byKey = {
    ...initialState.settings.byKey,
    ...cached.settings.byKey,
  };

  if (!cached.emojiGroups) {
    cached.emojiGroups = initialState.emojiGroups;
  }

  if (!cached.topPeerCategories) {
    cached.topPeerCategories = initialState.topPeerCategories;
  }

  if (!cached.users.savedMusicByPeerId) {
    cached.users.savedMusicByPeerId = initialState.users.savedMusicByPeerId;
  }

  if (!cached.musicSearch) {
    cached.musicSearch = initialState.musicSearch;
  }

  const cachedSharedSettings = cached.sharedState.settings;
  if (cachedSharedSettings.performance.textStreaming === undefined) {
    cachedSharedSettings.performance.textStreaming = true;
  }

  if (!cachedSharedSettings.foldersPosition) {
    cachedSharedSettings.foldersPosition = FOLDERS_POSITION_DEFAULT;
  }

  if (cachedSharedSettings.shouldReplaceTextShortcuts === undefined) {
    cachedSharedSettings.shouldReplaceTextShortcuts = true;
  }

  if (!cachedSharedSettings.keyboardShortcuts) {
    cachedSharedSettings.keyboardShortcuts = {};
  }

  if (cached.appConfig.isMessagePrimaryEditedDateEnabled === undefined) {
    cached.appConfig.isMessagePrimaryEditedDateEnabled = initialState.appConfig.isMessagePrimaryEditedDateEnabled;
  }

  if (cached.appConfig.richMessageLengthLimit === undefined) {
    cached.appConfig.richMessageLengthLimit = initialState.appConfig.richMessageLengthLimit;
    cached.appConfig.richMessageMaxBlocks = initialState.appConfig.richMessageMaxBlocks;
    cached.appConfig.richMessageMaxDepth = initialState.appConfig.richMessageMaxDepth;
    cached.appConfig.richMessageMaxMedia = initialState.appConfig.richMessageMaxMedia;
    cached.appConfig.richMessageMaxTableColumns = initialState.appConfig.richMessageMaxTableColumns;
  }

  if (cached.cacheVersion < 3) {
    cached.cacheVersion = 3;
    cached.messages = initialState.messages;
    cached.chats.listIds = initialState.chats.listIds;
  }

  if (cached.cacheVersion < 4) {
    // The default `patternColor` is now derived from the default wallpapers (`getDefaultPatternColor`).
    // Replace the old constant defaults so chips and wallpaper-aware surfaces agree, but keep any
    // wallpaper-derived color the user's own selection produced.
    if (untypedCached.settings.themes?.light?.patternColor === LEGACY_DEFAULT_PATTERN_COLOR) {
      untypedCached.settings.themes.light.patternColor = getDefaultPatternColor('light');
    }

    if (untypedCached.settings.themes?.dark?.patternColor === LEGACY_DARK_THEME_PATTERN_COLOR) {
      untypedCached.settings.themes.dark.patternColor = getDefaultPatternColor('dark');
    }

    cached.cacheVersion = 4;
  }

  if (cached.cacheVersion < 5) {
    // The account cache contains the authoritative themes until this migration moves them to shared state
    cachedSharedSettings.themes = untypedCached.settings.themes
      || cachedSharedSettings.themes
      || initialState.sharedState.settings.themes;
    delete untypedCached.settings.themes;
    cached.cacheVersion = 5;
  }

  if (cached.cacheVersion < 6) {
    Object.values(untypedCached.chats.byId).forEach((chat: any) => {
      if ('isCreator' in chat) {
        chat.isOwner = chat.isCreator;
        delete chat.isCreator;
      }
    });
    cached.cacheVersion = 6;
  }

  if (cached.cacheVersion < 7) {
    cached.cacheVersion = 7;
  }

  if (cached.cacheVersion < 8) {
    cached.cacheVersion = 8;
  }

  if (cached.cacheVersion < 10) {
    stripRemovedMessageFields(cached);
    Object.values(cached.messages.webPageById).forEach((webPage) => {
      // Instant View pages
      delete (webPage as AnyLiteral).cachedPage;
      delete (webPage as AnyLiteral).cachedPageAudioById;
    });
    // Cloud password and Telegram passkeys
    delete untypedCached.auth?.hint;
    delete untypedCached.auth?.passkeyOption;
    delete untypedCached.settings.byKey.hasPassword;
    delete untypedCached.appConfig?.arePasskeysAvailable;
    delete untypedCached.appConfig?.passkeysMaxCount;
    // Shareable folders
    delete untypedCached.chatFolders.invites;
    Object.values(cached.chatFolders.byId).forEach((folder) => {
      delete (folder as AnyLiteral).isChatList;
      delete (folder as AnyLiteral).hasMyInvites;
    });
    cached.cacheVersion = 10;
  }

  if (!cached.auth) {
    cached.auth = initialState.auth;
    cached.auth.rememberMe = untypedCached.authRememberMe;
  }

  if (cached.auth.rememberMe === undefined) {
    cached.auth.rememberMe = initialState.auth.rememberMe;
  }

  if (cached.audioPlayer.volume === undefined) {
    cached.audioPlayer.volume = initialState.audioPlayer.volume;
  }

  if (cached.audioPlayer.repeatMode === undefined) {
    cached.audioPlayer.repeatMode = initialState.audioPlayer.repeatMode;
  }

  if (cached.audioPlayer.orderMode === undefined) {
    cached.audioPlayer.orderMode = initialState.audioPlayer.orderMode;
  }
}

// Caches saved before Telegram-only features were removed still hold their fields
function removeTelegramOnlyFields(untypedCached: any) {
  const settings = untypedCached.settings?.byKey;
  if (settings) {
    delete settings.canTranslate;
    delete settings.translationLanguage;
    delete settings.translationTone;
    delete settings.canAutoLoadPhotoInChannels;
    delete settings.canAutoLoadVideoInChannels;
    delete settings.canAutoLoadFileInChannels;
  }
  delete untypedCached.settings?.notifyDefaults?.channels;
  delete untypedCached.settings?.lastPremiumBandwithNotificationDate;
  delete untypedCached.chatFolders?.areTagsEnabled;
  delete untypedCached.serviceNotifications;
  // Telegram calls
  delete untypedCached.groupCalls;
  delete untypedCached.phoneCall;
  // Forums, channels, communities and saved dialogs
  delete untypedCached.chats?.topicsInfoById;
  delete untypedCached.chats?.similarChannelsById;
  delete untypedCached.chats?.forDiscussionIds;
  delete untypedCached.chats?.listIds?.saved;
  delete untypedCached.chats?.orderedPinnedIds?.saved;
  delete untypedCached.chats?.totalCount?.saved;
  delete untypedCached.chats?.isFullyLoaded?.saved;
  delete untypedCached.chats?.loadingParameters?.saved;
  delete untypedCached.chats?.lastMessageIds?.saved;
  delete untypedCached.defaultTopicIconsId;
  // Saved reaction tags
  delete untypedCached.savedReactionTags;
  // QR code share themes
  delete untypedCached.shareThemeBackdrops;
  // Recommended folders
  delete untypedCached.chatFolders?.recommended;
  Object.values(untypedCached.chatFolders?.byId || {}).forEach((folder: any) => {
    delete folder.description;
  });

  Object.values(untypedCached.messages?.byChatId || {}).forEach((messageStore: any) => {
    delete messageStore.summaryById;
  });
}

function cloneThemeSettings(themes: Partial<Record<ThemeKey, IThemeSettings>>) {
  return {
    light: themes.light ? { ...themes.light } : undefined,
    dark: themes.dark ? { ...themes.dark } : undefined,
  };
}

function clearCachedDraftLocalFlags(cached: GlobalState) {
  Object.values(cached.messages.byChatId).forEach(({ threadsById }) => {
    Object.values(threadsById).forEach(({ localState }) => {
      const { draft } = localState;
      if (!draft) return;

      draft.isLocal = undefined;
    });
  });
}

function updateCache(force?: boolean) {
  const global = getGlobal();
  if (isRemovingCache || !isCaching || global.auth.isLoggingOut || (!force && getIsHeavyAnimating())) {
    return;
  }

  forceUpdateCache();
}

/** Writes the shared state now: before login, when the app does not cache state yet, settings survive a reload */
export function forceUpdateSharedStateCache() {
  if (GLOBAL_STATE_CACHE_DISABLED) return;
  const global = getGlobal();
  void cacheSharedState(reduceSharedState(global.sharedState));
}

export function temporarilySuspendCacheUpdate() {
  cacheUpdateSuspensionTimestamp = Date.now() + UPDATE_THROTTLE;
}

export function forceUpdateCache() {
  if (Date.now() < cacheUpdateSuspensionTimestamp) {
    return;
  }

  const global = getGlobal();
  const passcodeState = localStorage.getItem(IS_SCREEN_LOCKED_CACHE_KEY);
  if (passcodeState === 'enabling' || passcodeState === 'disabling') return;
  const hasPasscode = passcodeState === 'true' || passcodeState === 'false';
  if (!hasPasscode && global.passcode.hasPasscode) return;

  // With passcode enabled, content is never persisted in plaintext.
  // Full snapshots are written into the encrypted vault instead.
  if (hasPasscode) {
    const passcodeGlobal = global.passcode.hasPasscode ? global : updatePasscodeSettings(global, {
      hasPasscode: true,
    });
    cacheGlobal(clearGlobalForLockScreen(passcodeGlobal, false));
    cacheSharedState(reduceSharedState(global.sharedState));

    // Keep the vault snapshot fresh so content survives a boot-lock
    // (e.g. all tabs reloading at once), when there is no explicit lock to write it
    if (getDek() && !global.passcode.isScreenLocked) {
      void writeGlobalsVaultForSlot(ACCOUNT_SLOT, serializeGlobal(global));
    }
    return;
  }

  cacheGlobal(global);
  cacheSharedState(reduceSharedState(global.sharedState));
}

function reduceGlobal<T extends GlobalState>(global: T) {
  const reducedGlobal: GlobalState = {
    ...INITIAL_GLOBAL_STATE,
    ...pick(global, [
      'cacheVersion',
      'appConfig',
      'config',
      'auth',
      'currentUserId',
      'contactList',
      'topPeerCategories',
      'recentEmojis',
      'recentCustomEmojis',
      'emojiGroups',
      'attachmentSettings',
      'mediaEditorSettings',
      'leftColumnWidth',
      'archiveSettings',
      'mediaViewer',
      'audioPlayer',
      'shouldShowContextMenuHint',
      'recentlyFoundChatIds',
      'recentlyFoundSettingIds',
      'peerColors',
    ]),
    lastIsChatInfoShown: !getIsMobile() ? global.lastIsChatInfoShown : undefined,
    stickers: reduceStickers(global),
    customEmojis: reduceCustomEmojis(global),
    users: reduceUsers(global),
    chats: reduceChats(global),
    messages: reduceMessages(global),
    settings: reduceSettings(global),
    chatFolders: reduceChatFolders(global),
    reactions: {
      ...pick(global.reactions, [
        'defaultTags',
        'recentReactions',
        'topReactions',
        'hash',
      ]),
      availableReactions: reduceAvailableReactions(global.reactions.availableReactions),
    },
    passcode: pick(global.passcode, [
      'isScreenLocked',
      'hasPasscode',
      'hasPasskey',
      'autolockDuration',
      'invalidAttemptsCount',
      'timeoutUntil',
    ]),
  };

  return reducedGlobal;
}

function reduceSharedState(sharedState: SharedState): SharedState {
  return {
    ...sharedState,
    settings: {
      ...sharedState.settings,
      languages: undefined,
    },
    isInitial: undefined,
  };
}

export function serializeGlobal<T extends GlobalState>(global: T) {
  return stringifyJsonWithBigInt(reduceGlobal(global));
}

function reduceStickers<T extends GlobalState>(global: T): GlobalState['stickers'] {
  const { diceSetIdByEmoji, setsById, featured } = global.stickers;
  return {
    ...INITIAL_GLOBAL_STATE.stickers,
    diceSetIdByEmoji,
    setsById: pickTruthy(setsById, Object.values(diceSetIdByEmoji || {})),
    featured: {
      hiddenSetId: featured.hiddenSetId,
    },
  };
}

function reduceCustomEmojis<T extends GlobalState>(global: T): GlobalState['customEmojis'] {
  const { lastRendered, byId } = global.customEmojis;
  const folderEmojiIds = Object.values(global.chatFolders.byId)
    .flatMap((folder) => (
      folder.title.entities
        ?.filter((entity) => entity.type === ApiMessageEntityTypes.CustomEmoji)
        ?.map((entity) => entity.documentId) || []
    ));
  const idsToSave = unique([...folderEmojiIds, ...lastRendered]).slice(0, GLOBAL_STATE_CACHE_CUSTOM_EMOJI_LIMIT);
  const byIdToSave = pick(byId, idsToSave);

  return {
    byId: byIdToSave,
    lastRendered: idsToSave,
    forEmoji: {},
    added: {},
    statusRecent: {},
  };
}

function reduceUsers<T extends GlobalState>(global: T): GlobalState['users'] {
  const {
    users: {
      byId, statusesById, fullInfoById,
    }, currentUserId,
  } = global;
  const currentChatIds = compact(
    Object.values(global.byTabId)
      .map(({ id: tabId }) => selectCurrentMessageList(global, tabId)),
  ).map(({ chatId }) => chatId).filter((chatId) => isUserId(chatId));

  const visibleUserIds = unique(compact(Object.values(global.byTabId)
    .flatMap(({ id: tabId }) => selectVisibleUsers(global, tabId)?.map((u) => u.id) || [])));

  const chatStoriesUserIds = currentChatIds
    .flatMap((chatId) => Object.values(selectChatMessages(global, chatId) || {}))
    .map((message) => {
      const webPage = selectFullWebPageFromMessage(global, message);
      return message.content.storyData?.peerId || webPage?.story?.peerId;
    })
    .filter((id): id is string => Boolean(id) && isUserId(id));

  const topPeerIds = getTopPeerIds(global);

  const idsToSave = unique([
    ...currentUserId ? [currentUserId] : [],
    ...currentChatIds,
    ...chatStoriesUserIds,
    ...visibleUserIds || [],
    ...topPeerIds.filter(isUserId),
    ...global.recentlyFoundChatIds?.filter(isUserId) || [],
    ...getOrderedIds(ARCHIVED_FOLDER_ID)?.slice(0, GLOBAL_STATE_CACHE_ARCHIVED_CHAT_LIST_LIMIT).filter(isUserId) || [],
    ...getOrderedIds(ALL_FOLDER_ID)?.filter(isUserId) || [],
    ...global.contactList?.userIds || [],
    ...Object.keys(byId),
  ]).slice(0, GLOBAL_STATE_CACHE_USER_LIST_LIMIT);

  return {
    ...INITIAL_GLOBAL_STATE.users,
    byId: pickTruthy(byId, idsToSave),
    statusesById: pickTruthy(statusesById, idsToSave),
    fullInfoById: pickTruthy(fullInfoById, idsToSave),
  };
}

function reduceChats<T extends GlobalState>(global: T): GlobalState['chats'] {
  const { chats: { byId }, currentUserId } = global;
  const currentChatIds = compact(
    Object.values(global.byTabId)
      .map(({ id: tabId }): MessageList | undefined => {
        return selectCurrentMessageList(global, tabId);
      }),
  ).map(({ chatId }) => chatId);

  const messagesChatIds = compact(Object.values(global.byTabId).flatMap(({ id: tabId }) => {
    const messageList = selectCurrentMessageList(global, tabId);
    if (!messageList) return undefined;

    const messages = selectChatMessages(global, messageList.chatId);
    const viewportIds = selectViewportIds(global, messageList.chatId, messageList.threadId, tabId);
    return viewportIds?.map((id) => {
      const message = messages[id];
      if (!message) return undefined;
      const content = message.content;
      const webPage = selectFullWebPageFromMessage(global, message);
      const replyPeer = message.replyInfo?.type === 'message' && message.replyInfo.replyToPeerId;
      return content.storyData?.peerId || webPage?.story?.peerId || replyPeer;
    });
  }));
  const topPeerIds = getTopPeerIds(global);

  const unlinkedIdsToSave = [
    ...currentUserId ? [currentUserId] : [],
    ...currentChatIds,
    ...messagesChatIds,
    ...topPeerIds,
    ...global.recentlyFoundChatIds || [],
    ...getOrderedIds(ARCHIVED_FOLDER_ID)?.slice(0, GLOBAL_STATE_CACHE_ARCHIVED_CHAT_LIST_LIMIT) || [],
    ...getOrderedIds(ALL_FOLDER_ID) || [],
    ...Object.keys(byId),
  ];

  let idsToSave: string[] = [];

  for (const id of unlinkedIdsToSave) {
    if (byId[id]) idsToSave.push(id);
  }

  idsToSave = unique(idsToSave).slice(0, GLOBAL_STATE_CACHE_CHAT_LIST_LIMIT);

  return {
    ...global.chats,
    isFullyLoaded: {},
    notifyExceptionById: pickTruthy(global.chats.notifyExceptionById, idsToSave),
    loadingParameters: INITIAL_GLOBAL_STATE.chats.loadingParameters,
    byId: pickTruthy(global.chats.byId, idsToSave),
    fullInfoById: pickTruthy(global.chats.fullInfoById, idsToSave),
    lastMessageIds: {
      all: pickTruthy(global.chats.lastMessageIds.all || {}, idsToSave),
    },
  };
}

function getTopPeerIds<T extends GlobalState>(global: T) {
  return unique(Object.values(global.topPeerCategories).flatMap((category) => category?.peerIds || []));
}

function reduceMessages<T extends GlobalState>(global: T): GlobalState['messages'] {
  const { currentUserId } = global;
  const byChatId: GlobalState['messages']['byChatId'] = {};
  const serverTime = getServerTime();
  const currentChatIds = compact(
    Object.values(global.byTabId)
      .map(({ id: tabId }) => selectCurrentMessageList(global, tabId)),
  ).map(({ chatId }) => chatId);
  const chatIdsToSave = unique([
    ...currentChatIds,
    ...currentUserId ? [currentUserId] : [],
    ...getOrderedIds(ALL_FOLDER_ID) || [],
    ...getOrderedIds(ARCHIVED_FOLDER_ID)?.slice(0, GLOBAL_STATE_CACHE_ARCHIVED_CHAT_LIST_LIMIT) || [],
    ...Object.entries(global.messages.byChatId)
      .filter(([, { ephemeralById }]) => Object.keys(ephemeralById).length)
      .map(([chatId]) => chatId),
  ]);

  const openedChatThreadIds = Object.values(global.byTabId).reduce((acc, { id: tabId }) => {
    const { chatId: tabChatId, threadId } = selectCurrentMessageList(global, tabId) || {};
    if (!tabChatId || !threadId || threadId === MAIN_THREAD_ID) {
      return acc;
    }
    const current = acc[tabChatId] || new Set();
    current.add(threadId);
    acc[tabChatId] = current;

    return acc;
  }, {} as Record<string, Set<ThreadId>>);

  const pollIdsToSave: string[] = [];
  const webPageIdsToSave: string[] = [];

  chatIdsToSave.forEach((chatId) => {
    const current = global.messages.byChatId[chatId];
    if (!current) {
      return;
    }

    const chatLastMessageId = selectChatLastMessageId(global, chatId);

    const threadIds = Array.from(openedChatThreadIds[chatId] || []);

    const threadsToSave = pickTruthy(current.threadsById, [MAIN_THREAD_ID, ...threadIds]);

    const viewportIdsToSave = unique(Object.values(threadsToSave)
      .flatMap((thread) => thread.localState?.lastViewportIds || []));
    const lastMessageIdsToSave = [chatLastMessageId].filter(Boolean);
    const byId = pick(current.byId, viewportIdsToSave.concat(lastMessageIdsToSave));
    const threadsById = Object.keys(threadsToSave).reduce((acc, key) => {
      const thread = threadsToSave[Number(key)];
      acc[Number(key)] = {
        ...thread,
        localState: {
          ...thread.localState,
          listedIds: thread.localState?.lastViewportIds,
          draft: thread.localState?.draft,
          webPagePreviewId: undefined,
          typingStatusByPeerId: undefined,
        },
      };
      return acc;
    }, {} as GlobalState['messages']['byChatId'][string]['threadsById']);

    const cleanedById = Object.values(byId).reduce((acc, message) => {
      if (!message || message.isTypingDraft) return acc;

      const cleanedMessage = omitLocalMedia(message);
      acc[message.id] = cleanedMessage;

      if (message.content.pollId) {
        pollIdsToSave.push(message.content.pollId);
      }

      if (message.content.webPage) {
        webPageIdsToSave.push(message.content.webPage.id);
      }

      return acc;
    }, {} as Record<number, ApiMessage>);
    const ephemeralById = Object.values(current.ephemeralById).reduce((acc, message) => {
      if (
        message.sendingState
        || message.anchorMsgId
        || message.date + EPHEMERAL_MESSAGE_TTL_SECONDS <= serverTime
      ) {
        return acc;
      }

      acc[message.id] = omitLocalMedia(message);

      if (message.content.webPage) {
        webPageIdsToSave.push(message.content.webPage.id);
      }

      return acc;
    }, {} as Record<number, ApiMessage>);

    byChatId[chatId] = {
      byId: cleanedById,
      ephemeralById,
      anchoredById: {},
      threadsById,
    };
  });

  return {
    byChatId,
    pollById: pickTruthy(global.messages.pollById, pollIdsToSave),
    webPageById: pickTruthy(global.messages.webPageById, webPageIdsToSave),
    playbackByChatId: {},
  };
}

function omitLocalMedia(message: ApiMessage): ApiMessage {
  const {
    photo, video, document,
  } = message.content;

  return {
    ...message,
    content: {
      ...message.content,
      photo: photo && omitLocalPhoto(photo),
      video: video && omitLocalVideo(video),
      document: document && omitLocalDocument(document),
    },
    previousLocalId: undefined,
  };
}

function omitLocalPhoto(photo: ApiPhoto): ApiPhoto {
  return {
    ...photo,
    blobUrl: undefined,
  };
}

function omitLocalVideo(video: ApiVideo): ApiVideo {
  return {
    ...video,
    blobUrl: undefined,
    previewBlobUrl: undefined,
    editPreview: undefined,
  };
}

function omitLocalDocument(document: ApiDocument): ApiDocument {
  return {
    ...document,
    previewBlobUrl: undefined,
  };
}

function reduceSettings<T extends GlobalState>(global: T): GlobalState['settings'] {
  const {
    byKey, notifyDefaults, accountDaysTtl, chatThemes,
  } = global.settings;

  // Cached palettes remain usable offline; the catalog refresh restores wallpaper documents in the worker
  return {
    byKey,
    privacy: {},
    notifyDefaults,
    accountDaysTtl,
    chatThemes,
  };
}

function reduceChatFolders<T extends GlobalState>(global: T): GlobalState['chatFolders'] {
  return {
    ...global.chatFolders,
  };
}

function reduceAvailableReactions(
  availableReactions?: ApiAvailableReaction[],
): ApiAvailableReaction[] | undefined {
  return availableReactions
    ?.map((r) => ({ ...pick(r, ['reaction', 'staticIcon', 'title', 'isInactive']), isLocalCache: true }));
}

// Bot reply markup and inline bot attribution on cached messages
function stripRemovedMessageFields(cached: GlobalState) {
  Object.values(cached.messages.byChatId).forEach(({ byId, ephemeralById }) => {
    [...Object.values(byId), ...Object.values(ephemeralById)].forEach((message) => {
      const untypedMessage = message as AnyLiteral;
      const untypedContent = message.content as AnyLiteral;
      REMOVED_MESSAGE_FIELDS.forEach((field) => {
        delete untypedMessage[field];
      });
      REMOVED_MESSAGE_CONTENT_FIELDS.forEach((field) => {
        delete untypedContent[field];
      });
    });
  });
}
