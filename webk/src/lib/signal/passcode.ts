/*
 * TeleSignal: the passcode of the account, as Web K unlocks and locks it. The vault is Web A's (`src/util/passcode`):
 * the page unlocks it with the same passcode, restores the sessions from it and gives the engine the key of its
 * stores, the way Web A does (`finishUnlock` and `unlockScreen` in `src/global/actions/api/passcode.ts`). Passcodes are
 * set and changed in the A version. Nothing here erases data unless the user asks for it.
 */

import {
  forgetDek,
  getDek,
  getDekGeneration,
  getEngineKey,
  InvalidPasscodeError,
  loadPasscodeMeta,
  markPasscodeLocked,
  PasscodeDataCorruptedError,
  refreshSessionsVault,
  requestPasscodeStateLock,
  restoreSessionsFromVault,
  setDek,
  unlockDekWithPasscode,
  updatePasscodeMeta
} from '@signal-app/passcode';
import {broadcastPasscodeState} from '@signal-app/passcode-channel';
import clearSignalLocalData from '@signal-app/clear-local-data';
import {callSignalApi} from '@lib/signal/settingsApi';

// * Web A's `IS_SCREEN_LOCKED_CACHE_KEY` (`src/config.ts`): it is there while Web A has a passcode, and says whether the
// * vault is locked
const SCREEN_LOCKED_CACHE_KEY = 'tt-is-screen-locked';
// * Web A's invalid attempts (`src/global/actions/api/passcode.ts`): the passcode locks for a while after five
const MAX_INVALID_ATTEMPTS = 5;
const INVALID_ATTEMPTS_TIMEOUT_BASE_MS = 30 * 1000;
const INVALID_ATTEMPTS_TIMEOUT_MAX_MS = 5 * 60 * 1000;
// * the engine stops on the way to a lock; a stop that hangs must not keep the page from reloading
const ENGINE_STOP_TIMEOUT_MS = 3000;

export type SignalLockState = {
  hasPasscode: boolean,
  /** the vault is locked, or this page does not have its key, which the passcode gives */
  isLocked: boolean
};

export type SignalUnlockResult = {
  status: 'unlocked' | 'wrong' | 'failed' | 'corrupted'
} | {
  status: 'timeout',
  timeoutUntil: number
};

export async function getSignalLockState(): Promise<SignalLockState> {
  const meta = await loadPasscodeMeta();
  if(!meta) return {hasPasscode: false, isLocked: false};

  return {hasPasscode: true, isLocked: !!meta.isLocked || !getDek()};
}

/** The time until which the passcode is not accepted, while it is not */
export async function getSignalUnlockTimeout(): Promise<number | undefined> {
  const meta = await loadPasscodeMeta();
  return meta?.timeoutUntil && Date.now() < meta.timeoutUntil ? meta.timeoutUntil : undefined;
}

export async function unlockSignalPasscode(passcode: string): Promise<SignalUnlockResult> {
  const meta = await loadPasscodeMeta();
  if(!meta) return {status: 'failed'};

  const timeoutUntil = await getSignalUnlockTimeout();
  if(timeoutUntil) return {status: 'timeout', timeoutUntil};

  let dek: ArrayBuffer;
  try {
    dek = await unlockDekWithPasscode(passcode);
  } catch(err) {
    if(err instanceof InvalidPasscodeError) return recordInvalidAttempt(meta.generation);
    if(err instanceof PasscodeDataCorruptedError) return {status: 'corrupted'};
    return {status: 'failed'};
  }

  return finishUnlock(dek, meta.generation, meta.lockEpoch);
}

/** The key of the engine's stores, which the engine needs to start; the vault has to be unlocked in this page */
export async function getSignalStorageKey(): Promise<ArrayBuffer | undefined> {
  return await loadPasscodeMeta() ? getEngineKey() : undefined;
}

/**
 * Locks the vault for this page and the other tabs of the origin. The engine stops first, so that its keys are out of
 * memory, and the page reloads onto the lock screen.
 */
export async function lockSignalPasscode() {
  const generation = getDekGeneration();
  const dek = getDek();
  if(!generation || !dek) return;

  await refreshSessionsVault().catch(() => false);
  const lockEpoch = await requestPasscodeStateLock(() => markPasscodeLocked(generation));
  if(lockEpoch === undefined) return;

  localStorage.setItem(SCREEN_LOCKED_CACHE_KEY, 'true');
  broadcastPasscodeState(dek, generation);
  forgetDek(generation);
  await Promise.race([
    callSignalApi('destroy', true).catch((): undefined => undefined),
    new Promise((resolve) => setTimeout(resolve, ENGINE_STOP_TIMEOUT_MS))
  ]);
  location.reload();
}

/** Erases the engine data of this account slot, which the key cannot open, and reloads onto the lock screen */
export async function eraseUnreadableSignalData() {
  await clearSignalLocalData();
  location.reload();
}

async function recordInvalidAttempt(generation: string): Promise<SignalUnlockResult> {
  let invalidAttempt: ReturnType<typeof buildInvalidAttempt> | undefined;
  await requestPasscodeStateLock(() => updatePasscodeMeta((meta) => {
    invalidAttempt = buildInvalidAttempt(meta.invalidAttemptsCount);
    return {
      invalidAttemptsCount: invalidAttempt.invalidAttemptsCount,
      timeoutUntil: invalidAttempt.timeoutUntil
    };
  }, generation));

  if(!invalidAttempt) return {status: 'failed'};
  return invalidAttempt.timeoutUntil ?
    {status: 'timeout', timeoutUntil: invalidAttempt.timeoutUntil} :
    {status: 'wrong'};
}

function buildInvalidAttempt(previousAttemptsCount = 0) {
  const invalidAttemptsCount = previousAttemptsCount + 1;
  const timeoutUntil = invalidAttemptsCount >= MAX_INVALID_ATTEMPTS ?
    Date.now() + Math.min(
      INVALID_ATTEMPTS_TIMEOUT_BASE_MS * (2 ** (invalidAttemptsCount - MAX_INVALID_ATTEMPTS)),
      INVALID_ATTEMPTS_TIMEOUT_MAX_MS
    ) :
    undefined;
  return {invalidAttemptsCount, timeoutUntil};
}

async function finishUnlock(dek: ArrayBuffer, generation: string, lockEpoch: number): Promise<SignalUnlockResult> {
  return requestPasscodeStateLock(async(): Promise<SignalUnlockResult> => {
    const meta = await loadPasscodeMeta();
    if(meta?.generation !== generation || meta.lockEpoch !== lockEpoch || meta.isDisabling) {
      return {status: 'failed'};
    }

    setDek(dek, generation);
    try {
      await restoreSessionsFromVault(generation);
    } catch(err) {
      forgetDek(generation);
      return {status: 'corrupted'};
    }

    const isUnlocked = await updatePasscodeMeta({
      isLocked: false,
      invalidAttemptsCount: 0,
      timeoutUntil: undefined
    }, generation);
    if(!isUnlocked) {
      forgetDek(generation);
      return {status: 'failed'};
    }

    localStorage.setItem(SCREEN_LOCKED_CACHE_KEY, 'false');
    broadcastPasscodeState(dek, generation);
    return {status: 'unlocked'};
  });
}
