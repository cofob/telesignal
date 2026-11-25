/*
 * Originally from:
 * https://github.com/zhukov/webogram
 * Copyright (C) 2014 Igor Zhukov <igor.beatle@gmail.com>
 * https://github.com/zhukov/webogram/blob/master/LICENSE
 */

import type {ActiveAccountNumber} from '@lib/accounts/types';
import {Database} from '@config/databases';
import {CommonDatabase, getCommonDatabaseState} from '@config/databases/state';
import deepEqual from '@helpers/object/deepEqual';
import IDBStorage from '@lib/files/idb';
import {log, serviceMessagePort} from '@lib/serviceWorker/index.service';
import {ServicePushPingTaskPayload} from '@lib/serviceWorker/serviceMessagePort';
import {CURRENT_ACCOUNT_QUERY_PARAM} from '@lib/accounts/constants';
import getClientAccount from '@lib/serviceWorker/clientAccounts';
import DeferredIsUsingPasscode from '@lib/passcode/deferredIsUsingPasscode';
import EncryptionKeyStore from '@lib/passcode/keyStore';
import pause from '@helpers/schedulers/pause';

const ctx = self as any as ServiceWorkerGlobalScope;
const defaultBaseUrl = location.protocol + '//' + location.hostname + location.pathname.split('/').slice(0, -1).join('/') + '/';

export type PushNotificationObject = {
  loc_key: string,
  loc_args: string[],
  // user_id: number, // should be number
  custom: {
    channel_id?: string, // should be number
    chat_id?: string, // should be number
    from_id?: string, // should be number
    msg_id: string,
    story_id?: string, // should be number; set for story notifications
    peerId?: string, // should be number
    silent?: string // can be '1'
  },
  sound?: string,
  random_id: number,
  badge?: string, // should be number
  description: string,
  mute: string, // should be number
  title: string,
  message?: string,
  user_id?: number // receiver user id
} & { // will be set before postMessage to main thread
  action?: 'push_settings',
  accountNumber: ActiveAccountNumber
};

class SomethingGetter<T extends Database<any>, Storage extends Record<string, any>> {
  private cache: Partial<Storage> = {};
  private storage: IDBStorage<T>;

  constructor(
    db: T,
    storeName: T['stores'][number]['name'],
    private defaults: {
      [Property in keyof Storage]: ((value: Storage[Property]) => Storage[Property]) | Storage[Property]
    }
  ) {
    this.storage = new IDBStorage<T>(db, storeName);
  }

  private getDefault<T extends keyof Storage>(key: T) {
    const callback = this.defaults[key];
    return typeof(callback) === 'function' ? callback() : callback;
  }

  public get<T extends keyof Storage>(key: T) {
    if(this.cache.hasOwnProperty(key)) {
      return this.cache[key];
    }

    const promise = this.storage.get(key as string) as Promise<Storage[T]>;
    return promise.then((value) => value, () => undefined as Storage[T]).then((value) => {
      if(this.cache.hasOwnProperty(key)) {
        return this.cache[key];
      }

      value ??= this.getDefault(key);

      return this.cache[key] = value;
    });
  }

  public getCached<T extends keyof Storage>(key: T) {
    const value = this.get(key);
    if(value instanceof Promise) {
      throw 'no property';
    }

    return value;
  }

  public async set<T extends keyof Storage>(key: T, value: Storage[T]) {
    const cached = this.cache[key] ?? this.defaults[key];
    if(deepEqual(cached, value)) {
      return;
    }

    this.cache[key] = value;

    try {
      this.storage.save(key as string, value);
    } catch(err) {

    }
  }
}

type PushStorage = {
  push_settings: Partial<ServicePushPingTaskPayload['settings']>
  push_accounts: ServicePushPingTaskPayload['accounts']
};

const defaults: PushStorage = {
  push_settings: {},
  push_accounts: {}
};

const getter = new SomethingGetter<CommonDatabase, PushStorage>(getCommonDatabaseState(), 'session', defaults);

// fill cache
for(const i in defaults) {
  getter.get(i as keyof PushStorage);
}

async function isPasscodeLocked() {
  return Promise.race([
    pause(1000).then(() => undefined as boolean),
    Promise.all([
      DeferredIsUsingPasscode.isUsingPasscode(),
      EncryptionKeyStore.get()
    ]).then(([isUsingPasscode, encryptionKey]) => {
      return isUsingPasscode && !encryptionKey;
    })
  ]);
}

function onNotificationClick(event: NotificationEvent) {
  const notification = event.notification;
  log('on notification click', notification);
  notification.close();

  const action = event.action as PushNotificationObject['action'];
  const data: PushNotificationObject = notification.data;
  if(!data) {
    return;
  }

  // * clicks can overlap while the tabs' accounts are looked up: the order tells which one is newer
  const clickId = ++lastClickId;

  const promise = Promise.all([
    ctx.clients.matchAll({type: 'window'}),
    getter.get('push_settings'),
    getter.get('push_accounts'),
    isPasscodeLocked()
  ]).then(async([clientList, settings, accounts, isLocked]) => {
    data.action = action;
    for(const _accountNumber in accounts) { // * find correct account number for this notification
      const accountNumber = +_accountNumber as ActiveAccountNumber;
      if(accounts[accountNumber] === data.user_id) {
        data.accountNumber = accountNumber;
        break;
      }
    }

    // * all at once: a tab that has not said its account yet is waited for, and the focus must come soon.
    // * The click stays here meanwhile: a tab pinging in that time would take it as pending
    const clientAccounts = await Promise.all(clientList.map((client) => getClientAccount(client)));
    for(let i = 0; i < clientList.length; ++i) {
      const client = clientList[i];
      if(!('focus' in client)) {
        continue;
      }

      // * verify account number
      if(clientAccounts[i] !== data.accountNumber) {
        continue;
      }

      client.focus();
      if(isLocked) { // * wait until app is unlocked: the tab pings for it then
        setPendingNotification(data, clickId);
        return;
      }

      serviceMessagePort.invokeVoid('pushClick', data, client);
      // * and an earlier click still pending is superseded by this one - not a newer one
      if(pendingNotificationClickId < clickId) {
        pendingNotification = undefined;
      }
      return;
    }

    // * for the tab opened now, or the next one to ping
    setPendingNotification(data, clickId);
    if(ctx.clients.openWindow) {
      const url = new URL(settings.baseUrl || defaultBaseUrl);
      if(data.accountNumber && data.accountNumber > 1) { // * set account number
        url.searchParams.set(CURRENT_ACCOUNT_QUERY_PARAM, data.accountNumber + '');
      }

      return ctx.clients.openWindow(url);
    }
  }).catch((error) => {
    log.error('Clients.matchAll error', error);
  })

  event.waitUntil(promise);
}

const notifications: Set<Notification> = new Set();
let pendingNotification: PushNotificationObject, pendingNotificationClickId = 0, lastClickId = 0;
// * a click left for a tab to ping for: an older one does not take the place of a newer
function setPendingNotification(data: PushNotificationObject, clickId: number) {
  if(pendingNotification && pendingNotificationClickId > clickId) {
    return;
  }

  pendingNotification = data;
  pendingNotificationClickId = clickId;
}
function pushToNotifications(notification: Notification) {
  if(!notifications.has(notification)) {
    notifications.add(notification);
    // @ts-ignore
    notification.onclose = onCloseNotification;
  }
}

function onCloseNotification(event: NotificationEvent) {
  removeFromNotifications(event.notification)
}

function removeFromNotifications(notification: Notification) {
  notifications.delete(notification);
}

export function closeAllNotifications(tag?: string) {
  for(const notification of notifications) {
    try {
      if(tag && notification.tag !== tag) {
        continue;
      }

      notification.close();
      notifications.delete(notification);
    } catch(e) {}
  }

  let promise: Promise<void>;
  if('getNotifications' in ctx.registration) {
    promise = ctx.registration.getNotifications({tag}).then((notifications) => {
      for(let i = 0, len = notifications.length; i < len; ++i) {
        try {
          notifications[i].close();
        } catch(e) {}
      }
    }).catch((error) => {
      log.error('Offline register SW error', error);
    });
  } else {
    promise = Promise.resolve();
  }

  return promise;
}

export async function canSaveAccounts() {
  const [isUsingPasscode/* , encryptionKey */] = await Promise.all([
    DeferredIsUsingPasscode.isUsingPasscode()/* ,
    EncryptionKeyStore.get() */
  ]);
  // * if no passcode or app is unlocked
  return !isUsingPasscode/*  || !!encryptionKey */;
}

export async function onPing(payload: ServicePushPingTaskPayload, source?: MessageEventSource) {
  if(pendingNotification && source) {
    serviceMessagePort.invokeVoid('pushClick', pendingNotification, source);
    pendingNotification = undefined;
  }

  if(payload.settings) {
    getter.set('push_settings', payload.settings);
  }

  const canSave = await canSaveAccounts();
  getter.set('push_accounts', (canSave && payload.accounts) || defaults.push_accounts);
}

export function resetPushAccounts() {
  getter.set('push_accounts', defaults.push_accounts);
}

ctx.addEventListener('notificationclick', onNotificationClick);
ctx.addEventListener('notificationclose', onCloseNotification);
