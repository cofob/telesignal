/*
 * TeleSignal: the channel of Web A's passcode state (`src/util/passcode/channel.ts`), which tells the other tabs of
 * the origin that the vault was locked or unlocked, or that the sessions in it changed. Web K listens to it on a
 * channel of its own (`lib/signal/passcode`).
 */

export function broadcastPasscodeState(dek?: ArrayBuffer, generation?: string): void;

export function broadcastPasscodeSessionsChanged(generation: string): void;
