/*
 * TeleSignal: the errors that the Signal provider reports as `error` updates, said in Web K's strings. A change the
 * provider refused is reported once: the update shows its reason, and the method's rejection is marked handled.
 */

import type {LangPackKey} from '@lib/langPack';
import makeError from '@helpers/makeError';

// * the provider's error keys (`src/api/signal`) with Web K's strings; Web A maps the same keys in
// * `src/util/getReadableErrorText.ts`
const ERROR_LANG_KEYS: Record<string, LangPackKey> = {
  SIGNAL_GROUP_CHANGE_FAILED: 'Signal.Error.GroupChangeFailed',
  SIGNAL_GROUP_TITLE_TOO_LONG: 'Signal.Error.GroupTitleTooLong',
  SIGNAL_GROUP_DESCRIPTION_TOO_LONG: 'Signal.Error.GroupDescriptionTooLong',
  SIGNAL_GROUP_LAST_ADMIN: 'Signal.Error.GroupLastAdmin',
  SIGNAL_GROUP_LABEL_TOO_LONG: 'Signal.Error.GroupLabelTooLong',
  SIGNAL_HISTORY_TRANSFER_FAILED: 'Signal.Error.HistorySyncFailed',
  SIGNAL_KEY_TRANSPARENCY_FAILED: 'Signal.Error.KeyTransparencyFailed',
  SIGNAL_PIN_RESET_FAILED: 'Signal.Error.PinResetFailed'
};

// * errors that the rejected method shows in Web K's own way: the pin limit toast (`showPinLimitReached`) and the
// * expired link toast of joining by a link
const ERRORS_SHOWN_BY_METHOD = new Set(['SIGNAL_PINNED_LIMIT', 'INVITE_HASH_EXPIRED']);

/** The string of an error update of the provider, or nothing when the failed method shows the error itself */
export function getErrorLangKey(message: string | undefined): LangPackKey | undefined {
  if(message && ERRORS_SHOWN_BY_METHOD.has(message)) return undefined;
  return (message && ERROR_LANG_KEYS[message]) || 'Error.AnError';
}

/** The rejection of a method whose failure the provider reported as an update, which the page does not show again */
export function makeReportedError(type: string) {
  const error = makeError(type as ErrorType);
  error.handled = true;
  return error;
}
