/*
 * TeleSignal: what the page asks about the Signal engine's stores when it sets or removes the passcode, as Web A's
 * passcode actions do: the account slots whose data is in the browser (`src/lib/signal/engineSlots.ts`), the slots
 * whose engine runs (`src/lib/signal/store/engineLock.ts`) and whether any record is still encrypted
 * (`src/lib/signal/store/atRestMigration.ts`). Each of the three modules has an alias that this file types.
 */

export function getEngineSlots(): Promise<Set<number>>;

export function getRunningEngineSlots(): Promise<number[] | undefined>;

export function hasEncryptedEngineData(): Promise<boolean>;
