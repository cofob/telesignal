/*
 * TeleSignal: the proxy servers of the Signal engine, which both frontends share. Web A keeps them in its shared state
 * (`signalProxyUrl` and `signalSealedSenderProxyUrl`, `lib/signal/webAState`), and the engine takes them when it starts
 * (`startClient` in `src/api/signal/client.ts`).
 */

import I18n from '@lib/langPack';
import rootScope from '@lib/rootScope';
import {bindManagersToSession} from '@lib/accounts/bindManagersToAccount';
import {getSignalStorageKey} from '@lib/signal/passcode';
import {readWebASharedSettings, updateWebASharedSettings} from '@lib/signal/webAState';

export type SignalProxySettings = {
  signalProxyUrl?: string,
  // * the tunnel for connections without the account's credentials; `undefined` uses `signalProxyUrl`
  signalSealedSenderProxyUrl?: string
};

export async function getSignalProxySettings(): Promise<SignalProxySettings> {
  const {signalProxyUrl, signalSealedSenderProxyUrl} = await readWebASharedSettings();
  return {signalProxyUrl, signalSealedSenderProxyUrl};
}

/**
 * Saves the proxy servers where Web A reads them, and restarts this slot's engine with them, as Web A's
 * `saveProxySettings` reconnects: the live connections, an open link code and new requests move to the new tunnel.
 * The open tabs of Web A take the change too (`updateWebASharedSettings`). Rejects when the save or the restart failed;
 * a failed restart leaves the new servers saved, for the next start.
 */
export async function saveSignalProxySettings(changes: SignalProxySettings) {
  const managers = bindManagersToSession(rootScope.managers);
  await updateWebASharedSettings(changes);
  await managers.appSignalManager.restart(await getSignalStartArgs());
}

/** What the engine of this slot starts with, beside the user agent that its worker adds */
export async function getSignalStartArgs() {
  const [storageKey, proxySettings] = await Promise.all([
    getSignalStorageKey(),
    getSignalProxySettings().catch((): SignalProxySettings => ({}))
  ]);

  return {
    platform: navigator.platform,
    langCode: I18n.getLastRequestedLangCode(),
    storageKey,
    ...proxySettings
  };
}
