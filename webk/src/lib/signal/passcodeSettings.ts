/*
 * TeleSignal: setting, changing and removing the passcode from Web K, with the steps of Web A's passcode actions
 * (`setPasscode`, `clearPasscode` and `setPasscodeAutolockDuration` in `src/global/actions/api/passcode.ts`) on the
 * same vault (`src/util/passcode`), so that both frontends keep one passcode. Web A's global state is not in this
 * page: the vault takes Web A's cached global state of each slot instead, and gives it back to the cache when the
 * passcode goes. Page only; the engine is reached through the managers.
 */

import {
  abortPasscodeDisable,
  changePasscode,
  claimPasscodeDisable,
  clearLegacyEncryptedSession,
  clearPlaintextSessionStorage,
  commitPasscodeDisable,
  createPasscode,
  forgetDek,
  getDek,
  getDekGeneration,
  getEngineKey,
  GlobalSnapshot,
  loadPasscodeMeta,
  lockPasscodeSessionStore,
  markPasscodeLocked,
  readGlobalsVaultForSlot,
  refreshSessionsVault,
  requestPasscodeStateLock,
  restoreSessionsFromVault,
  restoreSessionsToPersistentStorage,
  updatePasscodeMeta
} from '@signal-app/passcode';
import {broadcastPasscodeState} from '@signal-app/passcode-channel';
import {resetSessionStore} from '@signal-app/passcode-session';
import {getEngineSlots} from '@signal-app/engine-slots';
import {getRunningEngineSlots} from '@signal-app/engine-lock';
import {hasEncryptedEngineData} from '@signal-app/engine-at-rest';
import {
  clearLockScreenWallpaperBlobs,
  clearPlaintextWallpaperBlobs,
  encryptWallpaperBlobs,
  restoreWallpaperBlobsFromPasscode
} from '@signal-app/wallpaper-vault';
import {purgePasscodeCaches} from '@signal-app/cache-api';
import {INITIAL_GLOBAL_STATE} from '@signal-app/initial-state';
import {parseJsonWithBigInt, stringifyJsonWithBigInt} from '@signal-app/numbers';
import {loadSlotSession} from '@signal-app/multiaccount';
import {getCurrentAccount} from '@lib/accounts/getCurrentAccount';
import type {LangPackKey} from '@lib/langPack';
import {callSignalApi} from '@lib/signal/settingsApi';
import {readWebAGlobalStates, removeWebAGlobalStates, writeWebAGlobalState} from '@lib/signal/webAState';
import noop from '@helpers/noop';

// * Web A's `IS_SCREEN_LOCKED_CACHE_KEY` (`src/config.ts`): there while a passcode is set, and while it is being set
// * (`enabling`) or removed (`disabling`)
const SCREEN_LOCKED_CACHE_KEY = 'tt-is-screen-locked';

type WebAGlobalState = Record<string, unknown> & {passcode?: Record<string, unknown>};

export type SignalPasscodeSetResult = {
  // * a passkey that unlocked the passcode does not survive its change, as in Web A
  hadPasskey?: boolean
};

/**
 * Sets the passcode, or changes it when one is set. A new passcode moves the account slots' sessions, Web A's cached
 * global states and wallpapers into the vault and encrypts the engine's stores with the vault's key. A setup that
 * fails after the vault was made locks it and reloads the page, as Web A does, so nothing stays in the clear.
 */
export async function setSignalPasscode(passcode: string): Promise<SignalPasscodeSetResult> {
  let isNewPasscode = false;
  let setupGeneration: string;
  try {
    return await requestPasscodeStateLock(async(): Promise<SignalPasscodeSetResult> => {
      if(await loadPasscodeMeta()) {
        await refreshSessionsVault();
        const result = await changePasscode(passcode);
        localStorage.setItem(SCREEN_LOCKED_CACHE_KEY, 'false');
        broadcastPasscodeState(getDek(), result.generation);
        return {hadPasskey: result.hadPasskey};
      }

      isNewPasscode = true;
      localStorage.setItem(SCREEN_LOCKED_CACHE_KEY, 'enabling');
      const context = await createPasscode(passcode, await collectGlobalSnapshots());
      setupGeneration = context.generation;
      await protectPasscodeStorage();
      localStorage.setItem(SCREEN_LOCKED_CACHE_KEY, 'false');
      broadcastPasscodeState(context.dek, context.generation);
      // * a failure here locks the passcode, and the next start of the engine finishes the encryption
      await encryptEngineStorage();
      return {};
    });
  } catch(err) {
    if(isNewPasscode) {
      if(await failClosedAfterPasscodeSetup(setupGeneration)) {
        location.reload();
      } else {
        resetSessionStore();
        localStorage.removeItem(SCREEN_LOCKED_CACHE_KEY);
      }
    }

    throw err;
  }
}

/**
 * Removes the passcode: the engine's stores are decrypted first, since the key goes with the passcode, then Web A's
 * cached global states, the wallpapers and the sessions go back to plain storage. Resolves with the message to show
 * when the passcode stays on.
 */
export async function clearSignalPasscode(): Promise<LangPackKey | undefined> {
  let failureKey: LangPackKey = 'Signal.Passcode.DataCorrupted';
  return requestPasscodeStateLock(async(): Promise<LangPackKey | undefined> => {
    const generation = getDekGeneration();
    if(!generation) return 'Error.AnError';

    await refreshSessionsVault();
    if(!await claimPasscodeDisable(generation)) return 'Error.AnError';
    localStorage.setItem(SCREEN_LOCKED_CACHE_KEY, 'disabling');

    try {
      const decryptFailureKey = await decryptEngineStorage();
      if(decryptFailureKey) {
        failureKey = decryptFailureKey;
        throw new Error(`[passcode] The engine's stores were not decrypted: ${decryptFailureKey}`);
      }

      await restoreGlobalCaches();
      await restoreWallpaperBlobsFromPasscode();
      await restoreSessionsToPersistentStorage(generation);
      await clearLegacyEncryptedSession();
      if(!await commitPasscodeDisable(generation) && await loadPasscodeMeta()) {
        throw new Error('[passcode] Failed to commit disable');
      }
      await clearLockScreenWallpaperBlobs().catch(noop);
    } catch(err) {
      if(await abortPasscodeDisable(generation)) {
        try {
          localStorage.setItem(SCREEN_LOCKED_CACHE_KEY, 'false');
          await restoreSessionsFromVault(generation);
          await protectPasscodeStorage();
          await encryptEngineStorage();
          broadcastPasscodeState(getDek(), generation);
        } catch(cleanupErr) {
          await lockPasscodeStateAfterFailure(generation, getDek());
          location.reload();
        }
      } else if(await loadPasscodeMeta()) {
        location.reload();
      }

      return failureKey;
    }

    localStorage.removeItem(SCREEN_LOCKED_CACHE_KEY);
    broadcastPasscodeState();
    return undefined;
  });
}

/** The time without activity after which the passcode locks, in milliseconds; `undefined` for never */
export async function getSignalAutolockDuration() {
  return (await loadPasscodeMeta())?.autolockDuration;
}

export async function setSignalAutolockDuration(duration: number | undefined) {
  const isUpdated = await requestPasscodeStateLock(() => (
    updatePasscodeMeta({autolockDuration: duration}, getDekGeneration())
  ));
  if(isUpdated) broadcastPasscodeState();
  return isUpdated;
}

/**
 * Web A's cached global state of each slot, as the vault keeps it while the passcode is on (`collectGlobalSnapshots`).
 * This slot gets Web A's initial state when Web A has not cached one, as Web A does for a slot with a session only.
 */
async function collectGlobalSnapshots(): Promise<GlobalSnapshot[]> {
  const states = await readWebAGlobalStates();
  const currentSlot = getCurrentAccount();
  if(!states.some(({slot}) => slot === currentSlot)) {
    states.push({
      slot: currentSlot,
      state: {...INITIAL_GLOBAL_STATE, currentUserId: loadSlotSession(currentSlot)?.userId}
    });
  }

  return states.map(({slot, state}) => ({
    slot,
    globalJson: stringifyJsonWithBigInt(updateGlobalPasscode(state, {
      hasPasscode: true,
      isScreenLocked: false,
      errorKey: undefined,
      isLoading: false
    }))
  }));
}

/** Gives Web A's cache the global state of each slot that the vault kept, without the passcode (`restoreGlobalCaches`) */
async function restoreGlobalCaches() {
  const slots = await getEngineSlots();
  for(const slot of slots) {
    const globalJson = await readGlobalsVaultForSlot(slot);
    if(!globalJson) continue;

    const state = parseJsonWithBigInt<WebAGlobalState>(globalJson);
    await writeWebAGlobalState(slot, {...state, passcode: {}});
  }
}

/** Takes what Web A keeps in the clear out of plain storage once the vault holds it (`protectPasscodeStorage`) */
async function protectPasscodeStorage() {
  await encryptWallpaperBlobs();
  // * Web K's lock screen shows no wallpaper, so none is kept for it
  await clearLockScreenWallpaperBlobs();
  await removeWebAGlobalStates();
  await purgePasscodeCaches();
  clearPlaintextSessionStorage();
}

/** Gives the engine the key of its stores, which it encrypts with it; anything but `true` is a failure */
async function encryptEngineStorage() {
  const slots = [...await getEngineSlots()];
  if(await callSignalApi('enableStorageEncryption', await getEngineKey(), slots) !== true) {
    throw new Error('[passcode] The engine\'s stores were not encrypted');
  }
}

/**
 * Decrypts the stores of every account slot before the key goes (`decryptEngineStorage`). Returns the message to show
 * when that did not happen: another slot's engine may be running, or a record cannot be decrypted.
 */
async function decryptEngineStorage(): Promise<LangPackKey | undefined> {
  const ownSlot = getCurrentAccount();
  const slots = [...await getEngineSlots()];
  const runningSlots = await getRunningEngineSlots();
  // * a browser that cannot tell which engines run is trusted only when no other slot has data
  const isOtherEngineRunning = runningSlots ?
    runningSlots.some((slot) => slot !== ownSlot) :
    slots.some((slot) => slot !== ownSlot);
  if(isOtherEngineRunning) return 'Signal.Passcode.CloseOtherAccounts';
  if(await callSignalApi('disableStorageEncryption', slots) !== true) return 'Signal.Passcode.StorageNotDecrypted';
  // * the key is deleted next, so the page checks the stores itself instead of taking the engine's word for it
  if(await hasEncryptedEngineData().catch(() => true)) return 'Signal.Passcode.StorageNotDecrypted';
  return undefined;
}

async function failClosedAfterPasscodeSetup(expectedGeneration: string | undefined) {
  return requestPasscodeStateLock(async() => {
    const meta = await loadPasscodeMeta();
    if(!meta || !expectedGeneration || meta.generation !== expectedGeneration) {
      forgetDek(expectedGeneration);
      return false;
    }

    const dek = getDekGeneration() === meta.generation ? getDek() : undefined;
    await lockPasscodeStateAfterFailure(meta.generation, dek);
    return true;
  });
}

async function lockPasscodeStateAfterFailure(generation: string, dek: ArrayBuffer | undefined) {
  await markPasscodeLocked(generation);
  localStorage.setItem(SCREEN_LOCKED_CACHE_KEY, 'true');
  await removeWebAGlobalStates().catch(noop);
  await clearPlaintextWallpaperBlobs().catch(noop);
  await purgePasscodeCaches().catch(noop);
  broadcastPasscodeState(dek, generation);
  forgetDek(generation);
  lockPasscodeSessionStore();
}

function updateGlobalPasscode(state: WebAGlobalState, update: Record<string, unknown>): WebAGlobalState {
  return {...state, passcode: {...state.passcode, ...update}};
}
