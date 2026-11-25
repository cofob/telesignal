/*
 * TeleSignal: `src/util/signalLinks.ts`, Web A's parser of Signal links (`signal.me`, `signal.group`, `signal.art`,
 * `signal.link`, `signal.tube` and `sgnl:`), which Web K's search and message links open as Web A does
 */

export type SignalLink = {
  type: 'usernameLink',
  url: string,
  encryptedUsername: string
} | {
  type: 'phoneNumber',
  /** The digits of the number, without `+` */
  phoneNumber: string
} | {
  type: 'groupInvite',
  url: string,
  inviteCode: string
} | {
  type: 'stickerPack',
  packId: string,
  packKey: string
} | {
  type: 'proxy',
  host: string
} | {
  type: 'callLink',
  key: string
} | {
  type: 'linkDevice',
  url: string
} | {
  type: 'reRegister'
} | {
  type: 'invalid'
};

/** The route of a Signal link, or `undefined` for anything else */
export function parseSignalLink(text: string): SignalLink | undefined;

/** Whether a text is a Signal link that the app can open, and not an `invalid` one */
export function isSignalRoute(text: string): boolean;
