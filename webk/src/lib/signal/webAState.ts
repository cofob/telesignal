/*
 * TeleSignal: the records of Web A's IndexedDB store `tt-data` (`MAIN_IDB_STORE` of `src/util/browser/idb.ts`, written
 * by `idb-keyval`) that Web K reads and changes: the shared state, with the settings both frontends share, and the
 * cached global state of each account slot. Changes of the shared settings reach the open tabs of Web A through the
 * channel of the two frontends (`listenOtherClients` in `src/util/browser/listenOtherClients.ts`).
 */

import App from '@config/app';
import {ActiveAccountNumber} from '@lib/accounts/types';

export type WebASharedSettings = {
  signalProxyUrl?: string,
  // * the tunnel for connections without the account's credentials; `undefined` uses `signalProxyUrl`
  signalSealedSenderProxyUrl?: string,
  // * the shortcuts changed from their defaults, by Web A's id: a combo, or `false` for none
  keyboardShortcuts?: Record<string, string | false>,
  // * the keys that send a message, which the defaults of sending and new lines follow
  messageSendKeyCombo?: 'enter' | 'ctrl-enter',
  // * the desktop app asks where to save each download (`lib/signal/desktopFiles`)
  shouldAskWhereToSave?: boolean,
  // * the window title of the desktop app names the open chat (`lib/signal/desktopIm`); on unless set to `false`
  canDisplayChatInTitle?: boolean
};

type SharedState = {settings?: WebASharedSettings, isInitial?: boolean};

// * the message Web A's tabs take the changed settings from (`SignalSharedSettingsMessage` in Web A)
export type WebASharedSettingsMessage = {type: 'signalSharedSettings', settings: WebASharedSettings};

const DB_NAME = 'tt-data';
const STORE_NAME = 'store';
// * `SHARED_STATE_CACHE_KEY` and `GLOBAL_STATE_CACHE_PREFIX` of Web A's `src/config.ts`
const SHARED_STATE_KEY = 'tt-shared-state';
const GLOBAL_STATE_KEY_PREFIX = 'tt-global-state';

export async function readWebASharedSettings(): Promise<WebASharedSettings> {
  const state = await runInStore<SharedState | undefined>('readonly', (store, resolve) => {
    const request = store.get(SHARED_STATE_KEY);
    request.onsuccess = () => resolve(request.result);
  });
  return state?.settings || {};
}

/** Saves settings into Web A's shared state, and tells Web A's open tabs, which keep a copy of it in memory */
export async function updateWebASharedSettings(changes: WebASharedSettings) {
  await runInStore<void>('readwrite', (store, resolve) => {
    const request = store.get(SHARED_STATE_KEY);
    request.onsuccess = () => {
      const state: SharedState = request.result;
      store.put({
        ...state,
        // * a shared state that Web A marked initial is not shared, and its next start would drop the change
        isInitial: undefined,
        settings: {...state?.settings, ...changes}
      }, SHARED_STATE_KEY);
      resolve();
    };
  });

  const channel = new BroadcastChannel(App.interclientBroadcastChannel);
  channel.postMessage({type: 'signalSharedSettings', settings: changes} satisfies WebASharedSettingsMessage);
  channel.close();
}

/** Removes Web A's cached global state of a slot that logged out, with its copy in `localStorage` */
export async function removeWebAGlobalState(accountNumber: ActiveAccountNumber) {
  // * `getGlobalStateCacheKey` of Web A
  const key = accountNumber === 1 ? GLOBAL_STATE_KEY_PREFIX : `${GLOBAL_STATE_KEY_PREFIX}_${accountNumber}`;
  localStorage.removeItem(key);
  await runInStore<void>('readwrite', (store, resolve) => {
    store.delete(key).onsuccess = () => resolve();
  });
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

async function runInStore<T>(
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore, resolve: (value: T) => void) => void
) {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, mode);
      let result: T;
      callback(transaction.objectStore(STORE_NAME), (value) => result = value);
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}
