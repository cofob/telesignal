/*
 * TeleSignal: the account's own settings that Web K asks Telegram for, answered by the provider
 * (`src/api/signal/methods/settings.ts`).
 */

import type {InputNotifyPeer, PeerNotifySettings} from '@layer';
import makeError from '@helpers/makeError';
import type {SignalMethodHandlers, SignalMethodHost} from '@lib/signal/methodHost';
import type {SignalNotifyDefault, SignalNotifyDefaults} from '@lib/signal/settingsApi';

export function buildAccountMethodHandlers(host: SignalMethodHost): SignalMethodHandlers {
  return {
    // * the disappearing messages timer that new private chats start with, as Signal's universal expire timer
    'messages.getDefaultHistoryTTL': async() => {
      const period: number = await host.call('fetchDefaultHistoryTtl');
      if(period === undefined) throw makeError('SIGNAL_NO_ACCOUNT' as ErrorType);
      return {_: 'defaultHistoryTTL', period};
    },
    'messages.setDefaultHistoryTTL': async({period}: {period: number}) => {
      if(!await host.call('setDefaultHistoryTtl', {period})) throw makeError('SIGNAL_SAVE_FAILED' as ErrorType);
      return true;
    },
    // * the notification defaults of private chats and groups, which the engine keeps on this device; a chat's own
    // * settings come with its dialog
    'account.getNotifySettings': async({peer}: {peer: InputNotifyPeer}): Promise<PeerNotifySettings> => {
      if(peer._ === 'inputNotifyPeer' || peer._ === 'inputNotifyForumTopic' || peer._ === 'inputNotifyCommunity') {
        return {_: 'peerNotifySettings'};
      }

      const defaults: SignalNotifyDefaults = await host.call('fetchNotifyDefaultSettings');
      return buildNotifySettings(peer._ === 'inputNotifyUsers' ? defaults?.users : defaults?.groups);
    }
  };
}

/**
 * Signal's defaults as Telegram's: previews on and off are Signal's notification content "Name and message" and
 * "Name only", and a muted type is muted for good
 */
export function buildNotifySettings(settings: SignalNotifyDefault | undefined): PeerNotifySettings {
  return {
    _: 'peerNotifySettings',
    show_previews: settings?.shouldShowPreviews ?? true,
    mute_until: settings?.mutedUntil || 0
  };
}
