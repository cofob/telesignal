/*
 * TeleSignal: the notices Signal has and Telegram has not (safety numbers, group changes, donations, payments), which
 * Web K shows as the text of a custom service action. The adapter builds them in the worker, which has no language
 * pack, so the action's text carries the lang key and its arguments, and the page formats them
 * (`wrapMessageActionTextNewUnsafe`).
 */

// * an invisible separator that no text of a Telegram action starts with
const SIGNAL_NOTICE_PREFIX = '⁣signal-notice:';

/** An argument of a notice: a text as it is (a name), a number, or another lang key's text */
export type SignalNoticeArgument = string | number | {key: string};
export type SignalNotice = {key: string, args?: SignalNoticeArgument[]};

export function encodeSignalNotice(key: string, args?: SignalNoticeArgument[]) {
  return SIGNAL_NOTICE_PREFIX + JSON.stringify({key, args} satisfies SignalNotice);
}

/** The notice a custom action's text carries, or nothing for any other text */
export function decodeSignalNotice(text: string): SignalNotice | undefined {
  if(!text.startsWith(SIGNAL_NOTICE_PREFIX)) return undefined;
  try {
    return JSON.parse(text.slice(SIGNAL_NOTICE_PREFIX.length));
  } catch(err) {
    return undefined;
  }
}
