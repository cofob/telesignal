import type { VerificationSession } from '../../lib/signal/account/register';
import type { RestoreProgress } from '../../lib/signal/backups/restoreBackup';
import type { Credentials } from '../../lib/signal/net/rest';
import type { AccountRecord } from '../../lib/signal/store/SignalStore';
import type { SvrErrorReason } from '../../lib/signal/svr/svr2';
import type { RegularLangKey } from '../../types/language';
import type { RegularLangFnParameters } from '../../util/localization/types';
import type { ApiAuthCodeTransport, ApiBackupRestoreState, ApiUpdateAuthorizationStateType } from '../types';

import { IS_SIGNAL_BACKUPS_ENABLED } from '../../config';
import { updateAccountAttributes } from '../../lib/signal/account/accountAttributes';
import { normalizeRecoveryKey } from '../../lib/signal/account/recoveryKey';
import {
  completeRegistration,
  createVerificationSession,
  registerAccount,
  RegistrationError,
  RegistrationLockError,
  requestVerificationCode,
  submitCaptcha,
  submitVerificationCode,
} from '../../lib/signal/account/register';
import {
  adoptRecoveryKey, findRemoteBackup, restoreBackupFile, RestoreError,
  restoreRemoteBackup } from '../../lib/signal/backups/restoreBackup';
import { resetPinGuessCount } from '../../lib/signal/svr/accountPin';
import { restoreMasterKey, SvrError } from '../../lib/signal/svr/svr2';
import { formatMediaDuration } from '../../util/dates/duration';
import { db, logError, processor, store } from './engine';
import { sendApiUpdate } from './updates';

type RegistrationProfile = {
  firstName: string;
  lastName?: string;
  isDiscoverableByPhoneNumber?: boolean;
};

type RegistrationState = {
  number?: string;
  session?: VerificationSession;
  codeTransport?: ApiAuthCodeTransport;
  // The number has Registration Lock: the account is created once the PIN restores its master key
  registrationLock?: {
    profile: RegistrationProfile;
    svr2Credentials: Credentials;
    // `Date.now()` when the lock expires
    expiresAt?: number;
    // Kept once the PIN restored the master key, so a registration that fails afterwards retries without using up
    // another guess; `resetRegistration` drops it
    restored?: { masterKey: Uint8Array; pin: string };
  };
  // Registered on the server, waiting for its profile
  account?: AccountRecord;
  // The step that offers to restore a backup is waiting for the user
  restore?: {
    account: AccountRecord;
    resolve(outcome: RestoreOutcome): void;
    // The recovery key is being checked or restored: a second submission would start a second restore, and skipping
    // would complete the registration under it
    isRunning?: boolean;
    // Aborts the restore when the registration is reset
    abortController: AbortController;
  };
};

type RestoreOutcome = 'skipped' | 'restored' | 'canceled';

const CAPTCHA_PREFIX = 'signalcaptcha://';
const MS_IN_SECOND = 1000;
const MS_IN_DAY = 24 * 60 * 60 * MS_IN_SECOND;
// The error code of the notification, see `READABLE_ERROR_KEYS` in `src/util/getReadableErrorText.ts`
const PIN_RESET_FAILED_ERROR = 'SIGNAL_PIN_RESET_FAILED';
// Errors that leave the guesses and the PIN screen as they are
const PIN_ERROR_KEYS = {
  rateLimited: 'SignalPinErrorRateLimited',
  unavailable: 'SignalPinErrorUnavailable',
  protocolError: 'ErrorUnexpected',
} satisfies Record<Exclude<SvrErrorReason, 'pinMismatch' | 'missing'>, RegularLangKey>;

let state: RegistrationState = {};
let languages: string[] = [];
// Changes when the flow restarts, so a step that finishes after a restart does not show its result
let generation = 0;
// A PIN is being checked: a second submission would use up a guess for nothing
let isPinPending = false;

/**
 * Registers a new account with this browser as its primary device: phone number, captcha, code, then the
 * profile name, which completes the registration. The steps answer the app's authorization actions.
 */
export function startRegistration(langCode?: string) {
  resetRegistration();
  languages = [...new Set([langCode, ...navigator.languages].filter(Boolean))] as string[];
  sendAuthState('authorizationStateWaitPhoneNumber');
}

/** Shows the profile step of an account whose registration stopped after the server created it */
export function resumeRegistration(account: AccountRecord) {
  resetRegistration();
  state.account = account;
  sendAuthState('authorizationStateWaitRegistration');
}

export function resetRegistration() {
  generation++;
  state.restore?.abortController.abort();
  state.restore?.resolve('canceled');
  state = {};
}

export function submitRegistrationPhoneNumber(phoneNumber: string) {
  const number = `+${phoneNumber}`;
  return runStep('authorizationStateWaitPhoneNumber', async () => {
    state.number = number;
    return handleSession(await createVerificationSession(number));
  });
}

export function submitRegistrationCaptcha(captchaLink: string) {
  const token = captchaLink.trim().replace(/\/$/, '');
  if (!token.startsWith(CAPTCHA_PREFIX) || token.length === CAPTCHA_PREFIX.length) {
    sendAuthState('authorizationStateWaitCaptcha');
    sendAuthError({ key: 'SignalCaptchaErrorFormat' });
    return Promise.resolve();
  }

  return runStep('authorizationStateWaitCaptcha', async () => {
    const session = await submitCaptcha(state.session!.id, token.slice(CAPTCHA_PREFIX.length));
    if (!session.allowedToRequestCode && session.requestedInformation.includes('captcha')) {
      state.session = session;
      return () => {
        sendAuthState('authorizationStateWaitCaptcha');
        sendAuthError({ key: 'SignalCaptchaErrorRejected' });
      };
    }
    return handleSession(session);
  });
}

export function requestRegistrationCode(transport: ApiAuthCodeTransport) {
  return runStep('authorizationStateWaitCode', () => requestCode(transport));
}

export function submitRegistrationCode(code: string) {
  return runStep('authorizationStateWaitCode', async () => {
    const session = await submitVerificationCode(state.session!.id, code);
    state.session = session;
    if (!session.verified) {
      return () => {
        sendCodeState();
        sendAuthError({ key: 'ErrorCodeInvalid' });
      };
    }
    return () => sendAuthState('authorizationStateWaitRegistration');
  });
}

/**
 * Creates the account with the verified session, unless it exists already, and completes it with the profile.
 * Resolves with the account once it is ready to connect. A number with Registration Lock asks for the PIN first.
 */
export async function submitRegistrationProfile(profile: RegistrationProfile) {
  let completedAccount: AccountRecord | undefined;
  await runStep('authorizationStateWaitRegistration', async () => {
    try {
      // A resumed registration keeps the discoverability it was created with
      state.account ??= await registerAccount(store, {
        number: state.number!,
        sessionId: state.session!.id,
        isDiscoverableByPhoneNumber: Boolean(profile.isDiscoverableByPhoneNumber),
      });
    } catch (err) {
      if (!(err instanceof RegistrationLockError) || !err.svr2Credentials) throw err;
      state.registrationLock = {
        profile,
        svr2Credentials: err.svr2Credentials,
        expiresAt: err.timeRemaining !== undefined ? Date.now() + err.timeRemaining : undefined,
      };
      return () => sendAuthState('authorizationStateWaitPassword');
    }
    completedAccount = await restoreAndComplete(state.account, profile);
    return () => resetRegistration();
  });
  return completedAccount;
}

/**
 * Restores the master key of a locked number with its PIN and creates the account with the lock's token, as Signal
 * Desktop `standaloneInstaller` `verifyPIN` and Signal Android `SvrRepository.restoreMasterKeyPreRegistration`.
 * Storing the key again afterwards resets the guess count (Signal Android `ResetSvrGuessCountJob`).
 */
export async function submitRegistrationPin(pin: string) {
  const lock = state.registrationLock;
  if (!lock || isPinPending) return undefined;

  isPinPending = true;
  let completedAccount: AccountRecord | undefined;
  try {
    await runStep('authorizationStateWaitPassword', async () => {
      lock.restored ??= { masterKey: (await restoreMasterKey(lock.svr2Credentials, pin)).masterKey, pin };
      const { masterKey, pin: restoredPin } = lock.restored;
      state.account ??= await registerAccount(store, {
        number: state.number!,
        sessionId: state.session!.id,
        isDiscoverableByPhoneNumber: Boolean(lock.profile.isDiscoverableByPhoneNumber),
        masterKey,
      });
      completedAccount = await restoreAndComplete(state.account, lock.profile);
      try {
        await resetPinGuessCount(completedAccount, restoredPin, masterKey);
      } catch (err) {
        // The account works; changing the PIN in the settings resets the guess count later
        logError(err);
        sendApiUpdate({ '@type': 'error', error: { message: PIN_RESET_FAILED_ERROR, hasErrorKey: true } });
      }
      return () => resetRegistration();
    });
  } finally {
    isPinPending = false;
  }
  return completedAccount;
}

/**
 * Offers to restore a backup of the account with its recovery key (Signal Android registration: the restore selection
 * and the recovery key entry come after the account exists), then completes the profile. A restored backup brings the
 * profile name along, which the account keeps instead of the one that was just typed.
 */
async function restoreAndComplete(account: AccountRecord, profile: RegistrationProfile) {
  // Without the flag the registration has no restore step
  const outcome = IS_SIGNAL_BACKUPS_ENABLED ? await offerRestore(account) : 'skipped';
  if (outcome === 'canceled') throw new Error('Registration was reset');

  const restoredAccount = state.account ?? account;
  if (outcome !== 'restored') return completeProfile(restoredAccount, profile);

  const self = await db.getConversation(restoredAccount.aci);
  return completeProfile(restoredAccount, {
    ...profile,
    firstName: self?.profileName ?? profile.firstName,
    lastName: self?.profileFamilyName ?? profile.lastName,
  });
}

async function completeProfile(account: AccountRecord, { firstName, lastName }: RegistrationProfile) {
  const name = { givenName: firstName.trim(), familyName: lastName?.trim() || undefined };
  const completedAccount = await completeRegistration(store, account, name);
  // The first storage manifest, which the connection creates, has our name from our conversation
  await processor.updateOwnConversation({ profileName: name.givenName, profileFamilyName: name.familyName });
  return completedAccount;
}

/** Shows the restore step and waits until the user restored a backup or skipped it */
function offerRestore(account: AccountRecord) {
  return new Promise<RestoreOutcome>((resolve) => {
    state.restore = { account, resolve, abortController: new AbortController() };
    sendBackupRestoreState({});
  });
}

/** Restores the backup of a recovery key from the backup service, or from a backup file the user chose */
export async function submitRegistrationRestore(recoveryKey: string, file?: Uint8Array<ArrayBuffer>) {
  const restore = state.restore;
  if (!restore || restore.isRunning) return;

  restore.isRunning = true;
  const restoreGeneration = generation;
  const accountEntropyPool = normalizeRecoveryKey(recoveryKey);
  let found: { size: number; modifiedAt?: number } | undefined;
  const options = {
    store,
    processor,
    account: restore.account,
    accountEntropyPool,
    signal: restore.abortController.signal,
    onProgress: ({ step, progress }: RestoreProgress) => {
      if (restoreGeneration === generation) sendBackupRestoreState({ step, progress, found });
    },
  };
  try {
    sendBackupRestoreState({ step: 'verifying' });
    if (!file) {
      found = await findRemoteBackup(options);
      sendBackupRestoreState({ step: 'verifying', found });
      await restoreRemoteBackup(options);
    } else {
      await restoreBackupFile(file, options);
    }

    const account = await adoptRecoveryKey(store, accountEntropyPool);
    state.account = account;
    // The recovery password that the server holds is the one of the key that this registration made up
    updateAccountAttributes(account).catch(logError);
    restore.resolve('restored');
  } catch (err) {
    if (restoreGeneration !== generation) return;
    if (!(err instanceof RestoreError)) logError(err);
    sendBackupRestoreState({});
    sendAuthError(getRestoreErrorKey(err));
  } finally {
    restore.isRunning = false;
  }
}

/** Goes on without restoring: the account starts empty */
export function skipRegistrationRestore() {
  if (!state.restore || state.restore.isRunning) return;
  state.restore.resolve('skipped');
}

function getRestoreErrorKey(err: unknown): RegularLangFnParameters {
  if (!(err instanceof RestoreError)) return { key: 'ErrorUnexpected' };
  switch (err.reason) {
    case 'invalidKey':
      return { key: 'BackupsErrorInvalidKey' };
    case 'wrongKey':
      return { key: 'BackupsErrorWrongKey' };
    case 'noBackup':
      return { key: 'AuthRestoreErrorNoBackup' };
    case 'forwardSecrecyLost':
      return { key: 'BackupsErrorForwardSecrecy' };
    case 'invalidBackup':
      return { key: 'BackupsErrorInvalidBackup' };
    case 'rateLimited':
      return { key: 'BackupsErrorRateLimited' };
    default:
      return { key: 'BackupsErrorNetwork' };
  }
}

function sendBackupRestoreState(backupRestore: ApiBackupRestoreState) {
  sendApiUpdate({
    '@type': 'updateAuthorizationState', authorizationState: 'authorizationStateWaitBackupRestore', backupRestore,
  });
}

/** Moves to the step the session asks for; a session that allows a code request gets an SMS code right away */
async function handleSession(session: VerificationSession) {
  state.session = session;
  if (session.verified) return () => sendAuthState('authorizationStateWaitRegistration');
  if (session.allowedToRequestCode) return requestCode(session.nextSms !== undefined ? 'sms' : 'voice');
  if (session.requestedInformation.includes('captcha')) return () => sendAuthState('authorizationStateWaitCaptcha');

  // A push challenge needs a mobile push token, which a browser does not have
  return () => {
    sendAuthState('authorizationStateWaitPhoneNumber');
    sendAuthError({ key: 'SignalRegisterErrorChallenge' });
  };
}

async function requestCode(transport: ApiAuthCodeTransport) {
  state.session = await requestVerificationCode(state.session!.id, transport, languages);
  state.codeTransport = transport;
  return sendCodeState;
}

/**
 * Runs a step and shows its result: the next screen, or `screen` again with the error. Steps return the
 * update to show, so a step that a restart made stale shows nothing.
 */
async function runStep(screen: ApiUpdateAuthorizationStateType, step: () => Promise<() => void>) {
  const stepGeneration = generation;
  let showResult: () => void;
  try {
    showResult = await step();
  } catch (err) {
    showResult = () => showError(screen, err);
  }
  if (stepGeneration === generation) showResult();
}

function showError(screen: ApiUpdateAuthorizationStateType, err: unknown) {
  if (err instanceof SvrError) {
    showPinError(err);
    return;
  }
  if (!(err instanceof RegistrationError)) {
    logError(err);
    sendAuthState(screen);
    sendAuthError({ key: 'ErrorUnexpected' });
    return;
  }

  if (err.session) state.session = { ...err.session, id: state.session!.id };
  switch (err.reason) {
    case 'invalidNumber':
      sendAuthState('authorizationStateWaitPhoneNumber');
      sendAuthError({ key: 'ErrorPhoneNumberInvalid' });
      break;
    case 'rateLimited': {
      const retryAfter = err.retryAfter ?? state.session?.nextVerificationAttempt;
      // A limited code request after the captcha or the number still leads to the code screen and its timers
      const isCodeScreen = screen !== 'authorizationStateWaitRegistration' && state.session?.allowedToRequestCode;
      sendScreen(isCodeScreen ? 'authorizationStateWaitCode' : screen);
      sendAuthError(retryAfter !== undefined
        ? { key: 'ErrorFloodTime', variables: { time: formatMediaDuration(retryAfter) } }
        : { key: 'ErrorUnexpected' });
      break;
    }
    case 'sessionNotFound':
      resetRegistration();
      sendAuthState('authorizationStateWaitPhoneNumber');
      sendAuthError({ key: 'SignalRegisterErrorSession' });
      break;
    case 'captchaRejected':
      sendAuthState('authorizationStateWaitCaptcha');
      sendAuthError({ key: 'SignalCaptchaErrorRejected' });
      break;
    case 'notReadyForVerification':
      if (state.session?.requestedInformation.includes('captcha')) {
        sendAuthState('authorizationStateWaitCaptcha');
        break;
      }
      sendScreen(screen);
      sendAuthError({ key: 'SignalCodeErrorNotRequested' });
      break;
    case 'codeSendFailed':
      sendCodeState();
      sendAuthError({ key: 'SignalCodeErrorSendFailed' });
      break;
    case 'codeNotDeliverable':
      sendCodeState();
      sendAuthError({ key: err.isPermanent ? 'SignalCodeErrorNoCode' : 'SignalCodeErrorUndeliverable' });
      break;
    case 'registrationLock':
      // The lock has no SVR2 data, or the PIN did not unlock it: only its expiry helps
      showLockedError(err instanceof RegistrationLockError ? err.timeRemaining : undefined);
      break;
    case 'rejected':
      sendScreen(screen);
      sendAuthError({ key: 'SignalRegisterErrorRejected' });
      break;
    case 'network':
      sendScreen(screen);
      sendAuthError({ key: 'SignalRegisterErrorNetwork' });
      break;
  }
}

function showPinError(err: SvrError) {
  if (err.reason === 'pinMismatch' && err.triesRemaining) {
    sendAuthState('authorizationStateWaitPassword');
    sendAuthError({
      key: 'SignalPinErrorIncorrect',
      variables: { count: err.triesRemaining },
      options: { pluralValue: err.triesRemaining },
    });
    return;
  }
  if (err.reason !== 'pinMismatch' && err.reason !== 'missing') {
    if (err.reason === 'unavailable') logError(err);
    sendAuthState('authorizationStateWaitPassword');
    sendAuthError({ key: PIN_ERROR_KEYS[err.reason] });
    return;
  }
  // No guesses are left, so SVR2 deleted the data
  const expiresAt = state.registrationLock?.expiresAt;
  showLockedError(expiresAt !== undefined ? Math.max(0, expiresAt - Date.now()) : undefined);
}

function showLockedError(timeRemaining?: number) {
  const days = Math.max(1, Math.ceil((timeRemaining ?? 0) / MS_IN_DAY));
  resetRegistration();
  sendAuthState('authorizationStateWaitPhoneNumber');
  sendAuthError(timeRemaining !== undefined
    ? { key: 'SignalPinErrorLocked', variables: { count: days }, options: { pluralValue: days } }
    : { key: 'SignalPinErrorLockedNoTime' });
}

function sendScreen(screen: ApiUpdateAuthorizationStateType) {
  if (screen === 'authorizationStateWaitCode') {
    sendCodeState();
    return;
  }
  sendAuthState(screen);
}

/** The code screen with the session's resend times converted to local times */
function sendCodeState() {
  const { session, codeTransport } = state;
  const now = Date.now();
  sendApiUpdate({
    '@type': 'updateAuthorizationState',
    authorizationState: 'authorizationStateWaitCode',
    phoneNumber: state.number,
    codeInfo: {
      transport: codeTransport,
      nextSmsAt: session?.nextSms !== undefined ? now + session.nextSms * MS_IN_SECOND : undefined,
      nextCallAt: session?.nextCall !== undefined ? now + session.nextCall * MS_IN_SECOND : undefined,
    },
  });
}

function sendAuthState(authorizationState: ApiUpdateAuthorizationStateType) {
  sendApiUpdate({ '@type': 'updateAuthorizationState', authorizationState, phoneNumber: state.number });
}

function sendAuthError(errorKey: RegularLangFnParameters) {
  sendApiUpdate({ '@type': 'updateAuthorizationError', errorKey });
}
