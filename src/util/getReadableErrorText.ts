import type { ApiError } from '../api/types';
import type { RegularLangKey } from '../types/language';
import type { LangFn } from './localization';

import { DEBUG } from '../config';

const READABLE_ERROR_KEYS: Record<string, RegularLangKey> = {
  SIGNAL_HISTORY_TRANSFER_FAILED: 'SignalHistorySyncFailed',
  SIGNAL_STARTUP_FAILED: 'SignalStartupFailed',
  SIGNAL_KEY_TRANSPARENCY_FAILED: 'KeyTransSelfFailedText',
  SIGNAL_PINNED_LIMIT: 'SignalPinnedLimit',
  SIGNAL_PIN_RESET_FAILED: 'SignalPinErrorResetFailed',
  CHAT_RESTRICTED: 'ErrorChatRestricted',
  CHAT_SEND_POLL_FORBIDDEN: 'ErrorChatSendPollForbidden',
  CHAT_SEND_STICKERS_FORBIDDEN: 'ErrorChatSendStickersForbidden',
  CHAT_SEND_GIFS_FORBIDDEN: 'ErrorChatSendGifsForbidden',
  CHAT_SEND_MEDIA_FORBIDDEN: 'ErrorChatSendMediaForbidden',
  CHAT_LINK_EXISTS: 'ErrorChatLinkExists',
  SLOWMODE_WAIT_X: 'ErrorSlowmodeWaitX',
  USER_BANNED_IN_CHANNEL: 'ErrorUserBannedInChannel',
  USER_IS_BLOCKED: 'ErrorUserIsBlocked',
  YOU_BLOCKED_USER: 'ErrorYouBlockedUser',
  IMAGE_PROCESS_FAILED: 'ErrorImageProcessFailed',
  MEDIA_EMPTY: 'ErrorMediaEmpty',
  MEDIA_GROUPED_INVALID: 'ErrorMediaGroupedInvalid',
  MEDIA_NEW_INVALID: 'ErrorMediaNewInvalid',
  MESSAGE_NOT_MODIFIED: 'ErrorMessageNotModified',
  MEDIA_INVALID: 'ErrorMediaInvalid',
  PASSWORD_HASH_INVALID: 'ErrorIncorrectPassword',
  PHOTO_EXT_INVALID: 'ErrorPhotoExtInvalid',
  PHOTO_INVALID_DIMENSIONS: 'ErrorPhotoInvalidDimensions',
  PHOTO_SAVE_FILE_INVALID: 'ErrorPhotoSaveFileInvalid',
  MESSAGE_DELETE_FORBIDDEN: 'ErrorMessageDeleteForbidden',
  MESSAGE_POLL_CLOSED: 'ErrorMessagePollClosed',
  MESSAGE_EDIT_TIME_EXPIRED: 'ErrorMessageEditTimeExpired',
  PINNED_DIALOGS_TOO_MUCH: 'ErrorPinnedDialogsTooMuch',
  CHANNEL_PRIVATE: 'ErrorChannelPrivate',
  MEDIA_CAPTION_TOO_LONG: 'ErrorMediaCaptionTooLong',
  ADDRESS_STREET_LINE1_INVALID: 'ErrorAddressStreetInvalid',
  ADDRESS_STREET_LINE2_INVALID: 'ErrorAddressStreetInvalid',
  ADDRESS_CITY_INVALID: 'ErrorAddressCityInvalid',
  ADDRESS_COUNTRY_INVALID: 'ErrorAddressCountryInvalid',
  ADDRESS_POSTCODE_INVALID: 'ErrorAddressPostcodeInvalid',
  ADDRESS_STATE_INVALID: 'ErrorAddressStateInvalid',
  REQ_INFO_NAME_INVALID: 'ErrorReqInfoNameInvalid',
  REQ_INFO_PHONE_INVALID: 'ErrorReqInfoPhoneInvalid',
  REQ_INFO_EMAIL_INVALID: 'ErrorReqInfoEmailInvalid',
  LINK_NOT_MODIFIED: 'ErrorLinkNotModified',
  MESSAGE_TOO_LONG: 'ErrorMessageTooLongText',
  SERVICE_WORKER_DISABLED: 'ErrorServiceWorkerDisabled',
  FRESH_RESET_AUTHORISATION_FORBIDDEN: 'ErrorFreshSessionLogout',
  BOTS_TOO_MUCH: 'ErrorBotsTooMuch',
  BOT_GROUPS_BLOCKED: 'ErrorBotGroupsBlocked',
  USERS_TOO_MUCH: 'ErrorUsersTooMuch',
  USER_CHANNELS_TOO_MUCH: 'ErrorUserChannelsTooMuch',
  USER_KICKED: 'ErrorUserKicked',
  USER_NOT_MUTUAL_CONTACT: 'ErrorUserNotMutualContact',
  USER_PRIVACY_RESTRICTED: 'ErrorUserPrivacyRestricted',
  INVITE_HASH_EMPTY: 'ErrorInviteHashEmpty',
  INVITE_HASH_EXPIRED: 'ErrorInviteHashExpired',
  INVITE_HASH_INVALID: 'ErrorInviteHashInvalid',
  CHANNELS_TOO_MUCH: 'ErrorChannelsTooMuch',
  USER_ALREADY_PARTICIPANT: 'ErrorUserAlreadyParticipant',
  SCHEDULE_DATE_INVALID: 'ErrorScheduleDateInvalid',
  WALLPAPER_DIMENSIONS_INVALID: 'ErrorWallpaperDimensionsInvalid',
  ADMINS_TOO_MUCH: 'ErrorAdminsTooMuch',
  ADMIN_RANK_EMOJI_NOT_ALLOWED: 'ErrorAdminRankEmojiNotAllowed',
  ADMIN_RANK_INVALID: 'ErrorAdminRankInvalid',
  FRESH_CHANGE_ADMINS_FORBIDDEN: 'ErrorFreshAdmin',
  SESSION_TOO_FRESH: 'ErrorSessionTooFresh',
  SESSION_IS_FRESH: 'ErrorSessionTooFresh',
  INPUT_USER_DEACTIVATED: 'ErrorInputUserDeactivated',
  PEERS_LIST_EMPTY: 'ErrorPeersListEmpty',
  SIGNAL_GROUP_CHANGE_FAILED: 'ErrorGroupChangeFailed',
  SIGNAL_CHAT_CHANGE_FAILED: 'ErrorChatChangeFailed',
  SIGNAL_GROUP_TITLE_TOO_LONG: 'ErrorGroupTitleTooLong',
  SIGNAL_GROUP_DESCRIPTION_TOO_LONG: 'ErrorGroupDescriptionTooLong',
  SIGNAL_GROUP_LAST_ADMIN: 'ErrorGroupLastAdmin',
  SIGNAL_GROUP_LABEL_TOO_LONG: 'ErrorGroupLabelTooLong',
};

if (DEBUG) {
  READABLE_ERROR_KEYS.CHAT_WRITE_FORBIDDEN = 'ErrorChatWriteForbidden';
  READABLE_ERROR_KEYS.CHAT_ADMIN_REQUIRED = 'ErrorChatAdminRequired';
}

const ERROR_CODES_WITHOUT_DIALOG = new Set([
  406,
]);

export default function getReadableErrorText(lang: LangFn, error: ApiError) {
  const { message, isSlowMode, textParams } = error;
  // The server supplies the remaining wait time in the slow-mode message
  if (isSlowMode) {
    const extraPartIndex = message.indexOf(' (caused by');
    return extraPartIndex > 0 ? message.substring(0, extraPartIndex) : message;
  }
  if (message === 'MESSAGE_TOO_LONG_PLEASE_REMOVE_CHARACTERS') {
    const count = Number(textParams?.['{EXTRA_CHARS_COUNT}'] ?? textParams?.EXTRA_CHARS_COUNT);
    return Number.isFinite(count) && count >= 0
      ? lang('ErrorMessageTooLong', { count }, { pluralValue: count })
      : lang('ErrorMessageTooLongText');
  }
  const key = READABLE_ERROR_KEYS[message];
  return key ? lang(key) : undefined;
}

export function shouldShowErrorDialog(error: ApiError): boolean {
  if (error.code && ERROR_CODES_WITHOUT_DIALOG.has(error.code)) return false;
  if (error.hasErrorKey && !error.isSlowMode && !READABLE_ERROR_KEYS[error.message]
    && error.message !== 'MESSAGE_TOO_LONG_PLEASE_REMOVE_CHARACTERS') return false;

  return true;
}
