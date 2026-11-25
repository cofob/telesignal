/*
 * Originally from:
 * https://github.com/zhukov/webogram
 * Copyright (C) 2014 Igor Zhukov <igor.beatle@gmail.com>
 * https://github.com/zhukov/webogram/blob/master/LICENSE
 */

import type {PushNotificationObject} from '@lib/serviceWorker/push';
import type {ServicePushPingTaskPayload} from '@lib/serviceWorker/serviceMessagePort';
import type {NotificationSettings} from '@lib/uiNotificationsManager';
import type ServiceMessagePort from '@lib/serviceWorker/serviceMessagePort';
import {MOUNT_CLASS_TO} from '@config/debug';
import {logger} from '@lib/logger';
import copy from '@helpers/object/copy';
import singleInstance from '@lib/singleInstance';
import EventListenerBase from '@helpers/eventListenerBase';
import AccountController from '@lib/accounts/accountController';
import appNavigationController from '@components/appNavigationController';
import Modes from '@config/modes';

const PING_PUSH_INTERVAL = 10000;

export class WebPushApiManager extends EventListenerBase<{
  push_notification_click: (n: PushNotificationObject) => void
}> {
  public isAvailable = true;
  private localNotificationsAvailable = true;
  private settings: NotificationSettings & {baseUrl?: string} = {} as any;
  private isAliveTO: any;
  private log = logger('PUSH-API');

  public serviceMessagePort: ServiceMessagePort<true>;

  constructor() {
    super(false);

    if(
      !('PushManager' in window) ||
      !('Notification' in window) ||
      !('serviceWorker' in navigator) ||
      Modes.noServiceWorker
    ) {
      this.log.warn('push messaging is not supported.');
      this.isAvailable = false;
      this.localNotificationsAvailable = false;
    }

    if(this.isAvailable && Notification.permission === 'denied') {
      this.log.warn('the user has blocked notifications.');
    }
  }

  public start() {
    this.setUpServiceWorkerChannel();
  }

  public setLocalNotificationsDisabled() {
    this.localNotificationsAvailable = false;
  }

  /**
   * TeleSignal: removes the push subscription that an earlier version made, which gave Telegram's push service (or the
   * browser's) a way to reach this browser. Nothing subscribes again: as in Web A, no push service is used, and the
   * notifications come from the open tabs
   */
  public unsubscribe() {
    if(!this.isAvailable) {
      return;
    }

    return navigator.serviceWorker.ready.then((reg) => {
      return reg.pushManager.getSubscription().then((subscription) => {
        if(!subscription) {
          return;
        }

        subscription.unsubscribe().then(() => {
          this.log('unsubscribed');
        }).catch((e) => {
          this.log.error('unsubscription error: ', e);
        });
      }).catch((e) => {
        this.log.error('error thrown while unsubscribing from ' +
          'push messaging.', e);
      });
    });
  }

  public isAliveNotify = async() => {
    if(!this.isAvailable || singleInstance.deactivatedReason) {
      return;
    }

    this.settings.baseUrl = (location.href || '').replace(/#.*$/, '');

    const accounts: ServicePushPingTaskPayload['accounts'] = {};
    const signedInAccounts = await AccountController.getAccounts();
    signedInAccounts.forEach(([accountNumber, accountData]) => {
      accounts[accountNumber] = accountData.userId;
    });

    const payload: ServicePushPingTaskPayload = {
      localNotifications: this.localNotificationsAvailable,
      settings: this.settings,
      accounts
    };

    this.serviceMessagePort.invokeVoid('pushPing', payload);

    this.isAliveTO = setTimeout(this.isAliveNotify, PING_PUSH_INTERVAL);
  }

  public setSettings(newSettings: WebPushApiManager['settings']) {
    this.settings = copy(newSettings);
    clearTimeout(this.isAliveTO);
    this.isAliveNotify();
  }

  public hidePushNotifications() {
    if(!this.isAvailable) {
      return;
    }

    this.serviceMessagePort.invokeVoid('notificationsClear', undefined);
  }

  public setUpServiceWorkerChannel() {
    if(!this.isAvailable) {
      return;
    }

    this.serviceMessagePort.addEventListener('pushClick', (payload) => {
      if(singleInstance.deactivatedReason) {
        appNavigationController.reload();
        return;
      }

      this.dispatchEvent('push_notification_click', payload);
    });

    navigator.serviceWorker.ready.then(this.isAliveNotify);
  }
}

const webPushApiManager = new WebPushApiManager();
MOUNT_CLASS_TO && (MOUNT_CLASS_TO.webPushApiManager = webPushApiManager);
export default webPushApiManager;
