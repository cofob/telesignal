/*
 * TeleSignal: `src/util/signalProxy.ts`, the check of a proxy server's URL that Web A's settings make. The error keys
 * are Web A's; Web K's language pack has them too.
 */

export type SignalProxyErrorKey = 'SignalProxyErrorInvalid' | 'SignalProxyErrorProtocol' | 'SignalProxyErrorCredentials';

/** Normalizes a proxy server URL: `wss://`, or `ws://` for this device, without credentials */
export function parseSignalProxyUrl(value: string): {url: string, errorKey?: undefined} | {url?: undefined, errorKey: SignalProxyErrorKey};

/** Resolves whether the tunnel accepts a WebSocket to Signal's chat host */
export function checkSignalProxyUrl(proxyUrl: string): Promise<boolean>;
