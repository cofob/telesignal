/*
 * TeleSignal: the channel of Web A's passcode state (`src/util/passcode/channel.ts`), which tells the other tabs of
 * the origin that the vault was locked or unlocked. Web K only sends.
 */

export function broadcastPasscodeState(dek?: ArrayBuffer, generation?: string): void;
