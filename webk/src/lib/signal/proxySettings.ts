/*
 * TeleSignal: the proxy servers of the Signal engine, which both frontends share. Web A keeps them in its shared state
 * (`signalProxyUrl` and `signalSealedSenderProxyUrl` of `tt-shared-state` in the IndexedDB store `tt-data`, written by
 * `idb-keyval`), and the engine takes them when it starts (`startClient` in `src/api/signal/client.ts`).
 */

import I18n from '@lib/langPack';
import rootScope from '@lib/rootScope';
import {bindManagersToSession} from '@lib/accounts/bindManagersToAccount';
import {getSignalStorageKey} from '@lib/signal/passcode';

export type SignalProxySettings = {
  signalProxyUrl?: string,
  // * the tunnel for connections without the account's credentials; `undefined` uses `signalProxyUrl`
  signalSealedSenderProxyUrl?: string
};

type SharedState = {settings?: SignalProxySettings, isInitial?: boolean};

// * `MAIN_IDB_STORE` and `SHARED_STATE_CACHE_KEY` of Web A
const DB_NAME = 'tt-data';
const STORE_NAME = 'store';
const SHARED_STATE_KEY = 'tt-shared-state';

export async function getSignalProxySettings(): Promise<SignalProxySettings> {
  const state = await readSharedState();
  return {
    signalProxyUrl: state?.settings?.signalProxyUrl,
    signalSealedSenderProxyUrl: state?.settings?.signalSealedSenderProxyUrl
  };
}

/**
 * Saves the proxy servers where Web A reads them, and restarts this slot's engine with them, as Web A's
 * `saveProxySettings` reconnects: the live connections, an open link code and new requests move to the new tunnel.
 * A Web A tab that is open keeps its own copy until it reloads.
 */
export async function saveSignalProxySettings(changes: SignalProxySettings) {
  const managers = bindManagersToSession(rootScope.managers);
  await updateSharedState((state) => ({
    ...state,
    // * a shared state that Web A marked initial is not shared, and its next start would drop the URL
    isInitial: undefined,
    settings: {...state?.settings, ...changes}
  }));

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

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME);
    // * a browser where Web A never ran: the store is made as `idb-keyval` makes it
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readSharedState() {
  const db = await openDb();
  try {
    return await new Promise<SharedState | undefined>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(SHARED_STATE_KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

async function updateSharedState(update: (state: SharedState | undefined) => SharedState) {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(SHARED_STATE_KEY);
      request.onsuccess = () => store.put(update(request.result), SHARED_STATE_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}
