/*
 * TeleSignal: the session values of Web A's passcode vault (`src/util/passcode/sessionStore.ts`). With a passcode they
 * are kept in memory while the vault is unlocked, and the page's storage reads and writes go through them.
 */

export function readSessionValue(key: string): string | undefined;

export function writeSessionValue(key: string, value: string): void;

export function removeSessionValue(key: string): void;
