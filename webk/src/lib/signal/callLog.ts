/*
 * TeleSignal: Web K's Calls tab over Signal's call log (Web A's `fetchCallLog`, `markCallLogSeen` and
 * `clearCallLog`). The tab reads the log as the call notices of the chats, which it groups into rows; opening it marks
 * the calls seen, here and on our other devices, as Web A's call list does.
 */

import type {MethodDeclMap, Message} from '@layer';
import type {SignalMethodHandlers, SignalMethodHost} from '@lib/signal/methodHost';
import {buildPeer, buildPhoneCallAction} from '@lib/signal/builders';

type SignalCallLogEntry = {
  chatId: string,
  callType: 'audio' | 'video' | 'group',
  isOutgoing: boolean,
  outcome: string,
  date: number,
  messageId?: number
};

export function buildCallLogHandlers(host: SignalMethodHost): SignalMethodHandlers {
  return {
    'messages.deletePhoneCallHistory': () => clearCallLog(host)
  };
}

/**
 * The call notices of the log, newest first, for the peerless search of `inputMessagesFilterPhoneCalls`. The log comes
 * whole, so a later page is empty. Group calls have no row in Web K's tab.
 */
export async function fetchCallLogMessages(host: SignalMethodHost, params: MethodDeclMap['messages.search']['req']) {
  const entries: SignalCallLogEntry[] = params.offset_id ? [] : (await host.call('fetchCallLog')) ?? [];
  if(!params.offset_id) void host.call('markCallLogSeen');
  const selfPeer = {_: 'peerUser', user_id: host.getManagers().appPeersManager.peerId.toUserId()} as const;
  const messages: Message.messageService[] = entries
  .filter(({callType, messageId}) => callType !== 'group' && messageId)
  .map((entry) => ({
    _: 'messageService',
    pFlags: {out: entry.isOutgoing || undefined},
    id: entry.messageId,
    peer_id: buildPeer(entry.chatId),
    from_id: entry.isOutgoing ? selfPeer : buildPeer(entry.chatId),
    date: entry.date,
    action: buildPhoneCallAction(entry.callType === 'video', entry.outcome)
  }));
  return {_: 'messages.messages', messages, chats: [], users: [], topics: []} as MethodDeclMap['messages.search']['res'];
}

/** Clears the log here and on our other devices; the engine deletes the call notices, which reach Web K as deletions */
async function clearCallLog(host: SignalMethodHost) {
  await host.call('clearCallLog');
  return {_: 'messages.affectedFoundMessages', pts: 0, pts_count: 0, offset: 0, messages: [] as number[]};
}
