/*
 * TeleSignal: the sign-in steps of the Signal engine as Web K follows them, linking with the QR code or registering a
 * phone number (`src/api/signal/registration.ts`). The engine sends each step as an authorization state, with what the
 * step shows, and a refused step as an error that names Web A's lang key.
 */

export type SignalAuthStateName =
  | 'authorizationStateWaitQrCode'
  | 'authorizationStateWaitPhoneNumber'
  | 'authorizationStateWaitCaptcha'
  | 'authorizationStateWaitCode'
  | 'authorizationStateWaitPassword'
  | 'authorizationStateWaitRegistration'
  | 'authorizationStateWaitBackupRestore'
  | 'authorizationStateReady';

/** How the code was sent, and when it can be sent again (local times in milliseconds) */
export type SignalAuthCodeInfo = {
  transport?: 'sms' | 'voice',
  nextSmsAt?: number,
  nextCallAt?: number
};

/** A restore of a backup at registration: waiting for the recovery key while `step` is not set */
export type SignalBackupRestore = {
  step?: 'verifying' | 'downloading' | 'validating' | 'importing',
  progress?: number,
  found?: {size: number, modifiedAt?: number}
};

/** The transfer of the message history from the primary device after it scanned the link code (`ApiHistorySyncProgress`) */
export type SignalHistorySync = {
  step: 'waiting' | 'downloading' | 'importing',
  // * from 0 to 1, while downloading and importing
  progress?: number
};

export type SignalAuthState = {
  state: SignalAuthStateName,
  // * the number being registered, with its `+`
  phoneNumber?: string,
  codeInfo?: SignalAuthCodeInfo,
  backupRestore?: SignalBackupRestore,
  // * set on the link code's step while the history comes, which replaces the code
  historySync?: SignalHistorySync
};

/** Web A's lang key of a refused step, with its variables (`RegularLangFnParameters`) */
export type SignalAuthError = {
  key: string,
  variables?: Record<string, string | number>,
  options?: {pluralValue?: number}
};
