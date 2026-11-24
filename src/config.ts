import type { ApiReactionEmoji } from './api/types';
import type {
} from './types';

export const APP_CODE_NAME = 'A';
export const APP_ENV = import.meta.env.TG_APP_ENV;
export const APP_NAME = import.meta.env.TG_APP_NAME || 'TeleSignal';

export const BASE_URL = import.meta.env.TG_PUBLIC_URL;
export const ACCOUNT_QUERY = 'account';

export const IS_TEST = APP_ENV === 'test';
export const IS_PERF = APP_ENV === 'perf';
export const IS_BETA = APP_ENV === 'staging';

export const DEBUG = APP_ENV !== 'production';
export const DEBUG_MORE = false;
export const DEBUG_CALLS = false;
export const DEBUG_LOG_FILENAME = 'tt-log.json';
export const STRICTERDOM_ENABLED = DEBUG;

// Signal Secure Backups (`src/lib/signal/backups`) stay off until their requests are checked against the live
// servers: the settings screen, the restore step of a registration and the backup schedule need this flag
export const IS_SIGNAL_BACKUPS_ENABLED = Boolean(import.meta.env.TG_SIGNAL_BACKUPS);

// Signal Desktop forwards up to 30 selected messages (`SelectModeActions.dom.tsx`) to up to 5 chats
// (`ForwardMessagesModal.dom.tsx`)
export const FORWARD_MESSAGES_MAX = 30;
export const FORWARD_CHATS_MAX = 5;

export const PAGE_TITLE = import.meta.env.TG_APP_TITLE;
export const PAGE_TITLE_TAURI = APP_NAME;

export const SESSION_ACCOUNT_PREFIX = 'account';

export const GLOBAL_STATE_CACHE_DISABLED = false;
export const GLOBAL_STATE_CACHE_PREFIX = 'tt-global-state';
export const SHARED_STATE_CACHE_KEY = 'tt-shared-state';
export const GLOBAL_STATE_CACHE_USER_LIST_LIMIT = 500;
export const GLOBAL_STATE_CACHE_CHAT_LIST_LIMIT = 200;
export const GLOBAL_STATE_CACHE_ARCHIVED_CHAT_LIST_LIMIT = 10;
export const GLOBAL_STATE_CACHE_CUSTOM_EMOJI_LIMIT = 150;

export const IS_SCREEN_LOCKED_CACHE_KEY = 'tt-is-screen-locked';
export const SHOULD_DELETE_LEGACY_PASSCODE_DATA = true;

export const MEDIA_CACHE_DISABLED = false;
export const MEDIA_CACHE_NAME = 'tt-media';
export const MEDIA_CACHE_NAME_AVATARS = 'tt-media-avatars';
export const MEDIA_PROGRESSIVE_CACHE_DISABLED = false;
export const MEDIA_PROGRESSIVE_CACHE_NAME = 'tt-media-progressive';
export const DOWNLOAD_KEY_CACHE_NAME = 'tt-download-key';
export const MEDIA_CACHE_MAX_BYTES = 512 * 1024; // 512 KB
export const CUSTOM_BG_CACHE_NAME = 'tt-custom-bg';
export const ASSET_CACHE_NAME = 'tt-assets';
// The stylesheets `index.html` links: the service worker serves them from this cache before any script runs
export const SNAPSHOT_CACHE_NAME = 'tt-wallpaper-snapshot';
export const WALLPAPER_SNAPSHOT_PATH = 'wallpaper-snapshot.css';
export const SKELETON_SNAPSHOT_PATH = 'skeleton-snapshot.css';
export const AUTODOWNLOAD_FILESIZE_MB_LIMITS = [1, 5, 10, 50, 100, 500];
export const DATA_BROADCAST_CHANNEL_PREFIX = 'tt-global';
export const ESTABLISH_BROADCAST_CHANNEL_PREFIX = 'tt-establish';
export const MULTITAB_LOCALSTORAGE_KEY_PREFIX = 'tt-multitab';
export const INTERCLIENT_BROADCAST_CHANNEL = 'tgweb';

export const DOWNLOAD_WORKERS = 16;
export const UPLOAD_WORKERS = 16;

const isBigScreen = typeof window !== 'undefined' && window.innerHeight >= 900;

export const MIN_PASSWORD_LENGTH = 1;

export const MESSAGE_LIST_SLICE = isBigScreen ? 60 : 40;
export const MESSAGE_LIST_VIEWPORT_LIMIT = MESSAGE_LIST_SLICE * 2;

export const ARCHIVE_MINIMIZED_HEIGHT = 36;
export const CHAT_HEIGHT_PX = 72;
export const TOPIC_HEIGHT_PX = 65;
export const PEER_PICKER_ITEM_HEIGHT_PX = 56;
export const CHAT_LIST_SLICE = isBigScreen ? 30 : 25;
export const CHAT_LIST_LOAD_SLICE = 100;
export const SHARED_MEDIA_SLICE = 42;
export const CHAT_MEDIA_SLICE = 42;
export const MEDIA_PRELOAD_OFFSET = 9;
export const PLAYLIST_OLDEST_ANCHOR_ID = 1;
export const PLAYLIST_NEWEST_ANCHOR_ID = 2 ** 31 - 1;
export const MESSAGE_SEARCH_SLICE = 42;
export const GLOBAL_SEARCH_SLICE = 20;
export const GLOBAL_TOPIC_SEARCH_SLICE = 5;
export const MEMBERS_SLICE = 30;
export const PROFILE_POLLS_SLICE = 20;
export const SAVED_MUSIC_SLICE = 30;
export const MEMBERS_LOAD_SLICE = 200;
export const PROFILE_SENSITIVE_AREA = 500;
export const TOPIC_LIST_SENSITIVE_AREA = 600;

export const VERIFY_AGE_MIN_DEFAULT = 18;

export const STORY_VIEWS_MIN_SEARCH = 15;
export const STORY_MIN_REACTIONS_SORT = 10;
export const STORY_VIEWS_MIN_CONTACTS_FILTER = 20;

export const MEDIA_TIMESTAMP_SAVE_MINIMUM_DURATION = 30; // 30s

export const GLOBAL_SUGGESTED_CHANNELS_ID = 'global';

// As in Telegram for Android
// https://github.com/DrKLO/Telegram/blob/51e9947527/TMessagesProj/src/main/java/org/telegram/messenger/MediaDataController.java#L7781
export const REACTION_UNREAD_SLICE = 100;
export const MENTION_UNREAD_SLICE = 100;
export const POLL_UNREAD_SLICE = 100;
export const TOPICS_SLICE = 20;
export const TOPICS_SLICE_SECOND_LOAD = 500;

export const TOP_CHAT_MESSAGES_PRELOAD_LIMIT = 20;

export const DEFAULT_VOLUME = 1;
export const DEFAULT_PLAYBACK_RATE = 1;
export const PLAYBACK_RATE_FOR_AUDIO_MIN_DURATION = 8 * 60; // 8 min
export const PREVIOUS_RESTART_THRESHOLD = 5;
export const SHUFFLE_PLAYLIST_LIMIT = 10000;
export const SHUFFLE_PRELOAD_THRESHOLD = 40;
export const REMEMBER_SHUFFLED_ORDER_ITEMS = 16;

export const ANIMATION_LEVEL_CUSTOM = -1;
export const ANIMATION_LEVEL_MIN = 0;
export const ANIMATION_LEVEL_MED = 1;
export const ANIMATION_LEVEL_MAX = 2;
export const ANIMATION_LEVEL_DEFAULT = ANIMATION_LEVEL_MED;

export const DEFAULT_MESSAGE_TEXT_SIZE_PX = 16;
export const IOS_DEFAULT_MESSAGE_TEXT_SIZE_PX = 17;
export const MACOS_DEFAULT_MESSAGE_TEXT_SIZE_PX = 15;
export const RICH_CONTENT_BODY_FONT_SIZE_PX = 18;

export const NBSP = '\u00A0';

export const FOLDERS_POSITION_TOP = 'top';
export const FOLDERS_POSITION_LEFT = 'left';
export const FOLDERS_POSITION_DEFAULT = FOLDERS_POSITION_TOP;

export const PREVIEW_AVATAR_COUNT = 3;

export const DRAFT_DEBOUNCE = 10000; // 10s
export const SEND_MESSAGE_ACTION_INTERVAL = 3000; // 3s
// 10000s from https://core.telegram.org/api/url-authorization#automatic-authorization
export const APP_CONFIG_REFETCH_INTERVAL = 10000 * 1000;
export const GENERAL_REFETCH_INTERVAL = 60 * 60 * 1000; // 1h

// Round video message recording
export const ROUND_VIDEO_RECORDING_SIZE = 400; // px, square output
export const MAX_ROUND_VIDEO_RECORDING_DURATION = 60 * 1000; // ms
export const MIN_ROUND_VIDEO_RECORDING_TIME = 1000; // ms, recordings shorter than this are discarded
export const VIDEO_RECORDING_FILENAME = 'video.mp4';
export const VIDEO_RECORDING_MIME_TYPE = 'video/mp4;codecs=avc1.42E01E,mp4a.40.2';
export const ROUND_VIDEO_BITRATE = 1_200_000; // bps
export const ROUND_AUDIO_BITRATE = 64_000; // bps

// Video editor
export const MAX_EDITABLE_VIDEO_SOURCE_SIZE = 1000 * 1024 * 1024;
export const MAX_EDITABLE_VIDEO_PIXELS = 4096 * 4096;
export const MAX_EDITABLE_VIDEO_OUTPUT_SIZE = 1024 * 1024 * 1024;
export const MIN_VIDEO_TRIM_DURATION = 1; // s
export const MIN_TRIMMABLE_VIDEO_DURATION = 1.5; // s
export const VIDEO_TIME_PRECISION = 0.001; // s
export const VIDEO_THUMB_MAX_SIDE = 320; // px
export const VIDEO_COVER_MAX_SIDE = 1280; // px
export const VIDEO_COVER_JPEG_QUALITY = 0.87;
export const VIDEO_MAX_FRAME_RATE = 60;
export const VIDEO_LOW_LEVEL_MAX_FRAME_RATE = 30;
export const VIDEO_GIF_LEVEL = 720;
export const VIDEO_GIF_MAX_SOURCE_SIZE = 10 * 1024 * 1024;
export const AVATAR_MIN_SIDE = 256; // px
export const AVATAR_MAX_SIDE = 800; // px
export const AVATAR_VIDEO_MAX_DURATION = 10; // s
export const AVATAR_VIDEO_MAX_FRAME_RATE = 30;

export const EDITABLE_INPUT_ID = 'editable-message-text';
export const EDITABLE_INPUT_MODAL_ID = 'editable-message-text-modal';
export const EDITABLE_STORY_INPUT_ID = 'editable-story-input-text';
// eslint-disable-next-line @stylistic/max-len
export const EDITABLE_INPUT_CSS_SELECTOR = `.messages-layout .Transition_slide-active #${EDITABLE_INPUT_ID}, .messages-layout .Transition > .Transition_slide-to #${EDITABLE_INPUT_ID}`;
export const EDITABLE_INPUT_MODAL_CSS_SELECTOR = `#${EDITABLE_INPUT_MODAL_ID}`;
export const EDITABLE_STORY_INPUT_CSS_SELECTOR = `#${EDITABLE_STORY_INPUT_ID}`;

export const CUSTOM_APPENDIX_ATTRIBUTE = 'data-has-custom-appendix';
export const MESSAGE_CONTENT_CLASS_NAME = 'message-content';
export const MESSAGE_CONTENT_SELECTOR = '.message-content';
export const VT_CLASS_NAME = 'active-view-transition';
export const VT_TYPE_CLASS_PREFIX = 'active-vt-';
export const STARS_ICON_PLACEHOLDER = '⭐';

export const MIN_SCREEN_WIDTH_FOR_STATIC_RIGHT_COLUMN = 1275; // px
export const MIN_SCREEN_WIDTH_FOR_STATIC_LEFT_COLUMN = 925; // px
export const MOBILE_SCREEN_MAX_WIDTH = 600; // px
export const MOBILE_SCREEN_LANDSCAPE_MAX_WIDTH = 950; // px
export const MOBILE_SCREEN_LANDSCAPE_MAX_HEIGHT = 450; // px

export const MAX_INT_32 = 2 ** 31 - 1;
export const TMP_CHAT_ID = '0';

export const MUTE_INDEFINITE_TIMESTAMP = MAX_INT_32;
export const UNMUTE_TIMESTAMP = 0;

export const ANIMATION_END_DELAY = 100;
export const ANIMATION_WAVE_MIN_INTERVAL = 200;
export const MESSAGE_APPEARANCE_DELAY = 10;

export const SCROLL_MIN_DURATION = 300;
export const SCROLL_MAX_DURATION = 600;
export const SCROLL_MAX_DISTANCE = 800;
export const SCROLL_SHORT_TRANSITION_MAX_DISTANCE = 300; // px

// Average duration of message sending animation
export const API_UPDATE_THROTTLE = Math.round((SCROLL_MIN_DURATION + SCROLL_MAX_DURATION) / 2);
export const API_THROTTLE_RESET_UPDATES = new Set([
  'newMessage',
  'newScheduledMessage',
  'deleteMessages',
  'deleteScheduledMessages',
  'deleteHistory',
  'deleteParticipantHistory',
]);

export const LOCK_SCREEN_ANIMATION_DURATION_MS = 200;

export const NOTIFICATION_MAX_VOLUME = 10;

export const STICKER_SIZE_INLINE_DESKTOP_FACTOR = 13;
export const STICKER_SIZE_INLINE_MOBILE_FACTOR = 11;
export const STICKER_SIZE_PICKER = 72;
export const EMOJI_SIZE_PICKER = 36;
export const COMPOSER_EMOJI_SIZE_PICKER = 32;
export const STICKER_SIZE_GENERAL_SETTINGS = 40;
export const STICKER_SIZE_PICKER_HEADER = 32;
export const STICKER_PICKER_MAX_SHARED_COVERS = 20;
export const STICKER_SIZE_SEARCH = 72;
export const STICKER_SIZE_MODAL = 72;
export const EMOJI_SIZE_MODAL = 36;
export const STICKER_SIZE_PASSCODE = 160;
export const STICKER_SIZE_DISCUSSION_GROUPS = 140;
export const STICKER_SIZE_FOLDER_SETTINGS = 100;
export const STICKER_SIZE_JOIN_REQUESTS = 140;
export const STICKER_SIZE_INVITES = 140;
export const RECENT_STICKERS_LIMIT = 20;
export const GLOBAL_STICKER_SEARCH_LIMIT = 100;
export const RECENT_STATUS_LIMIT = 20;
export const EMOJI_STATUS_LOOP_LIMIT = 2;
export const EMOJI_SIZES = 7;
export const TOP_SYMBOL_SET_ID = 'top';
export const POPULAR_SYMBOL_SET_ID = 'popular';
export const RECENT_SYMBOL_SET_ID = 'recent';
export const FAVORITE_SYMBOL_SET_ID = 'favorite';
export const CHAT_STICKER_SET_ID = 'chatStickers';
export const DEFAULT_STATUS_ICON_ID = 'status-default-icon';
export const EMOJI_IMG_REGEX = /<img[^>]+alt="([^"]+)"(?![^>]*data-document-id)[^>]*>/gm;

export const BASE_EMOJI_KEYWORD_LANG = 'en';

export const MENU_TRANSITION_DURATION = 200;
export const SLIDE_TRANSITION_DURATION = 450;

export const BIRTHDAY_NUMBERS_SET = 'FestiveFontEmoji';
export const RESTRICTED_EMOJI_SET = 'RestrictedEmoji';

export const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
export const SVG_EXTENSIONS = new Set(['svg', 'svgz']);

export const VIDEO_WEBM_TYPE = 'video/webm';
export const GIF_MIME_TYPE = 'image/gif';

export const LOTTIE_STICKER_MIME_TYPE = 'application/x-tgsticker';
export const VIDEO_STICKER_MIME_TYPE = VIDEO_WEBM_TYPE;

export const SUPPORTED_PHOTO_CONTENT_TYPES = new Set([
  'image/png', 'image/jpeg', GIF_MIME_TYPE,
]);

export const SUPPORTED_VIDEO_CONTENT_TYPES = new Set([
  'video/mp4', 'video/quicktime',
]);

export const SUPPORTED_AVATAR_CONTENT_TYPES = [
  ...SUPPORTED_PHOTO_CONTENT_TYPES, ...SUPPORTED_VIDEO_CONTENT_TYPES,
].join(', ');

export const SUPPORTED_AUDIO_CONTENT_TYPES = new Set([
  'audio/mp3',
  'audio/ogg',
  'audio/wav',
  'audio/mpeg',
  'audio/flac',
  'audio/aac',
  'audio/m4a',
  'audio/mp4',
  'audio/x-m4a',
]);

export const CONTENT_TYPES_WITH_PREVIEW = new Set([
  ...SUPPORTED_PHOTO_CONTENT_TYPES,
  ...SUPPORTED_VIDEO_CONTENT_TYPES,
]);

export const STORYBOARD_MIME = 'application/x-tgstoryboard';
export const STORYBOARD_MAP_MIME = 'application/x-tgstoryboardmap';

// eslint-disable-next-line @stylistic/max-len
export const RE_LINK_TEMPLATE = '((ftp|https?):\\/\\/)?((www\\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\\.[a-zA-Z][-a-zA-Z0-9]{1,62})\\b([-a-zA-Z0-9()@:%_+.,~#?&/=]*)';
export const RE_MENTION_TEMPLATE = '(@[\\w\\d_-]+)';
export const RE_TG_LINK = /^tg:(\/\/)?/i;
// Usernames link through the `tg:` scheme, which only the app itself handles
export const USERNAME_LINK_PREFIX = 'tg://resolve?domain=';
export const USERNAME_PURCHASE_ERROR = 'USERNAME_PURCHASE_AVAILABLE';
export const MESSAGE_ID_REQUIRED_ERROR = 'MESSAGE_ID_REQUIRED';
export const PURCHASE_USERNAME = 'auction';
export const ACCEPTABLE_USERNAME_ERRORS = new Set([USERNAME_PURCHASE_ERROR, 'USERNAME_INVALID']);
export const WEB_APP_PLATFORM = 'weba';
export const LANG_PACK = 'weba';

export const NSFW_RESTRICTION_REASON = 'sensitive';

// eslint-disable-next-line @stylistic/max-len
export const COUNTRIES_WITH_12H_TIME_FORMAT = new Set(['AU', 'BD', 'CA', 'CO', 'EG', 'HN', 'IE', 'IN', 'JO', 'MX', 'MY', 'NI', 'NZ', 'PH', 'PK', 'SA', 'SV', 'US']);

export const API_CHAT_TYPES = ['chats', 'users', 'groups'] as const;

export const HEART_REACTION: ApiReactionEmoji = {
  type: 'emoji',
  emoticon: '❤',
};

export const LOCAL_MESSAGES_LIMIT = 1e6; // 1M
export const DEFAULT_GIF_SEARCH_BOT_USERNAME = 'gif';
export const ALL_FOLDER_ID = 0;
export const ARCHIVED_FOLDER_ID = 1;
export const SAVED_FOLDER_ID = -1;
export const FOLDER_TITLE_MAX_LENGTH = 12;
export const MAX_MEDIA_FILES_FOR_ALBUM = 10;
export const MAX_ACTIVE_PINNED_CHATS = 5;
export const SCHEDULED_WHEN_ONLINE = 0x7FFFFFFE;
export const SUPPORT_URL = 'https://support.signal.org/';
export const PRIVACY_URL = 'https://signal.org/legal/#privacy-policy';
export const KEY_TRANSPARENCY_URL = 'https://support.signal.org/hc/articles/10223569377562';
export const GENERAL_TOPIC_ID = 1;

export const CALL_PROTOCOL_LIBRARY_VERSIONS = ['13.0.0'];

export const LIGHT_THEME_BG_COLOR = '#99BA92';
export const DARK_THEME_BG_COLOR = '#000000';
export const PEER_COLOR_BG_OPACITY = '1a';
export const PEER_COLOR_BG_ACTIVE_OPACITY = '2b';
export const PEER_COLOR_GRADIENT_STEP = 5; // px
export const MAX_UPLOAD_FILEPART_SIZE = 524288;

export const IGNORE_UNHANDLED_ERRORS = new Set([
  'USER_CANCELED',
]);

// Group calls
export const GROUP_CALL_VOLUME_MULTIPLIER = 100;
export const GROUP_CALL_DEFAULT_VOLUME = 100 * GROUP_CALL_VOLUME_MULTIPLIER;

export const ONE_TIME_MEDIA_TTL_SECONDS = 2147483647;
export const EPHEMERAL_MESSAGE_TTL_SECONDS = 48 * 60 * 60;

export const ACCOUNT_TTL_OPTIONS = [1, 3, 6, 12, 18, 24];

export const SLOT_MACHINE_EMOJI = '🎰';
