/*
 * TeleSignal: the page's side of Web A's passcode vault (`src/util/passcode`). Web K unlocks the vault the way Web A
 * does, so it runs the same module in its page; this file describes the part of the module that Web K uses. The
 * module itself is type-checked by the repository's `npm run check:ts`, with its stricter settings.
 */

export type PasscodeMeta = {
  generation: string,
  lockEpoch: number,
  isLocked?: boolean,
  isDisabling?: boolean,
  invalidAttemptsCount?: number,
  timeoutUntil?: number
};

export class InvalidPasscodeError extends Error {}

export class PasscodeDataCorruptedError extends Error {}

export function loadPasscodeMeta(): Promise<PasscodeMeta | undefined>;

export function unlockDekWithPasscode(passcode: string): Promise<ArrayBuffer>;

export function getDek(): ArrayBuffer | undefined;

export function getDekGeneration(): string | undefined;

export function setDek(dek: ArrayBuffer, generation: string): void;

export function forgetDek(expectedGeneration?: string): void;

export function updatePasscodeMeta(
  update: Partial<PasscodeMeta> | ((meta: PasscodeMeta) => Partial<PasscodeMeta>),
  expectedGeneration?: string
): Promise<boolean>;

export function markPasscodeLocked(generation: string): Promise<number | undefined>;

export function restoreSessionsFromVault(expectedGeneration: string): Promise<void>;

export function refreshSessionsVault(): Promise<boolean>;

export function getEngineKey(): Promise<ArrayBuffer>;

export function requestPasscodeStateLock<T>(callback: () => Promise<T>): Promise<T>;

export function removeGlobalsVaultForSlot(slot: number | undefined): Promise<void>;
