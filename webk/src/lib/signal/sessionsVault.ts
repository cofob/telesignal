/*
 * TeleSignal: the session values that Web K's page writes (the account slots), into Web A's passcode vault at once, as
 * Web A's `updateSessionStorage` does after each write: with a passcode they are kept in memory, and the vault is what
 * the next start and the other tabs read. Page only: the worker reaches the values through the page.
 */

import {
  getDekGeneration,
  refreshSessionsVault,
  requestPasscodeStateLock
} from '@signal-app/passcode';
import {broadcastPasscodeSessionsChanged} from '@signal-app/passcode-channel';
import {isSessionStoreLocked} from '@signal-app/passcode-session';

let flushing: Promise<void>;
let isFlushPending = false;

/**
 * Writes the changed session values into the vault and tells the other tabs. Writes that come while one flush runs are
 * taken by one more flush after it. Without a passcode nothing is kept in memory, and nothing is written.
 */
export function flushSessionsVault(): Promise<void> {
  if(flushing) {
    isFlushPending = true;
    return flushing;
  }

  flushing = requestPasscodeStateLock(async() => {
    const generation = getDekGeneration();
    if(!generation || isSessionStoreLocked()) return;
    if(await refreshSessionsVault()) broadcastPasscodeSessionsChanged(generation);
  }).finally(() => {
    flushing = undefined;
    if(isFlushPending) {
      isFlushPending = false;
      flushSessionsVault();
    }
  });

  return flushing;
}
