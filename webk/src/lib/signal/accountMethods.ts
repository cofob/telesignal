/*
 * TeleSignal: the account's own settings that Web K asks Telegram for, answered by the provider
 * (`src/api/signal/methods/settings.ts`).
 */

import makeError from '@helpers/makeError';
import type {SignalMethodHandlers, SignalMethodHost} from '@lib/signal/methodHost';

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
    }
  };
}
