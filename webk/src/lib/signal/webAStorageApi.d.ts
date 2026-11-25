/*
 * TeleSignal: the parts of Web A that its passcode moves into and out of the vault, which Web K's page moves the same
 * way: the wallpaper blobs (`src/util/wallpaper/vaultBlobs.ts`), the media caches (`purgePasscodeCaches` of
 * `src/util/cacheApi.ts`), the initial global state of a slot without a cached one (`src/global/initialState.ts`),
 * the global state's JSON with big integers (`src/util/numbers.ts`) and the sessions of the account slots
 * (`src/util/multiaccount.ts`). Each of these modules has an alias that this file types.
 */

export function encryptWallpaperBlobs(): Promise<void>;

export function restoreWallpaperBlobsFromPasscode(): Promise<void>;

export function clearPlaintextWallpaperBlobs(): Promise<void>;

export function clearLockScreenWallpaperBlobs(): Promise<void>;

export function purgePasscodeCaches(): Promise<void>;

export const INITIAL_GLOBAL_STATE: Record<string, unknown>;

export function stringifyJsonWithBigInt(value: unknown): string;

export function parseJsonWithBigInt<T>(json: string): T;

export function loadSlotSession(slot: number | undefined): {userId?: string} | undefined;
