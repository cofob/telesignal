/*
 * TeleSignal: the page's side of Web A's passcode vault (`src/util/passcode`). Web K sets, changes, unlocks and removes
 * the passcode the way Web A does, so it runs the same module in its page; this file describes the part of the module
 * that Web K uses. The module itself is type-checked by the repository's `npm run check:ts`, with its stricter settings.
 */

export type PasscodeMeta = {
  generation: string,
  lockEpoch: number,
  isLocked?: boolean,
  isDisabling?: boolean,
  invalidAttemptsCount?: number,
  timeoutUntil?: number,
  autolockDuration?: number,
  passkey?: {credentialId: number[]}
};

/** Web A's global state of an account slot, as JSON, that the vault keeps while the passcode is on */
export type GlobalSnapshot = {
  globalJson: string,
  slot: number
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

export function readGlobalsVaultForSlot(slot: number | undefined): Promise<string | undefined>;

export function createPasscode(passcode: string, globalSnapshots: GlobalSnapshot[]): Promise<{dek: ArrayBuffer, generation: string}>;

export function changePasscode(passcode: string): Promise<{generation: string, hadPasskey: boolean}>;

export function verifyPasscode(passcode: string): Promise<boolean>;

export function clearPlaintextSessionStorage(): void;

export function lockPasscodeSessionStore(): void;

export function claimPasscodeDisable(generation: string): Promise<boolean>;

export function abortPasscodeDisable(generation: string): Promise<boolean>;

export function commitPasscodeDisable(generation: string): Promise<boolean>;

export function restoreSessionsToPersistentStorage(expectedGeneration: string): Promise<void>;

export function clearLegacyEncryptedSession(): Promise<void>;
