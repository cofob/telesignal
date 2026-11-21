/*
 * TeleSignal: which messages delete for everyone. Signal Desktop `ts/util/canDeleteForEveryone.preload.ts` allows it
 * for our own messages and, in groups where we are an admin, for others' ones, a day after sending at most; the
 * engine applies the same limit (`DELETE_FOR_EVERYONE_MAX_AGE_MS` of `MessageProcessor`).
 */

import tsNow from '@helpers/tsNow';

const DELETE_FOR_EVERYONE_MAX_AGE = 24 * 60 * 60;

export function canDeleteMessageForEveryone(
  message: {date: number, pFlags: {out?: true}} | undefined,
  canDeleteOthers: boolean
) {
  if(!message) return false;
  return tsNow(true) - message.date <= DELETE_FOR_EVERYONE_MAX_AGE && (!!message.pFlags.out || canDeleteOthers);
}
