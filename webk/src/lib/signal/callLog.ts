/*
 * TeleSignal: Web K's Calls tab over Signal's call log (Web A's `fetchCallLog`, `markCallLogSeen` and
 * `clearCallLog`). The tab reads the log as the call notices of the chats, which it groups into rows; opening it marks
 * the calls seen, here and on our other devices, as Web A's call list does.
 */

import type {MethodDeclMap, Message, MessageAction} from '@layer';
import type {SignalMethodHandlers, SignalMethodHost} from '@lib/signal/methodHost';
import {buildPeer, buildPhoneCallAction} from '@lib/signal/builders';

// * entries with no 1:1 call notice take ids above any message's: group calls, whose notice is a text line that a
// * conference action must not replace in the chat's storage, and calls whose notice is gone
const NOTICELESS_CALL_ID_BASE = 2 ** 30;

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
 * whole, so a later page is empty. It lists every call, as Web A's call list does.
 */
export async function fetchCallLogMessages(host: SignalMethodHost, params: MethodDeclMap['messages.search']['req']) {
  const entries: SignalCallLogEntry[] = params.offset_id ? [] : (await host.call('fetchCallLog')) ?? [];
  if(!params.offset_id) void host.call('markCallLogSeen');
  const selfPeer = {_: 'peerUser', user_id: host.getManagers().appPeersManager.peerId.toUserId()} as const;
  const messages: Message.messageService[] = entries
  .map((entry, index) => {
    const isGroup = entry.callType === 'group';
    return {
      _: 'messageService',
      pFlags: {out: entry.isOutgoing || undefined},
      id: !isGroup && entry.messageId ? entry.messageId : NOTICELESS_CALL_ID_BASE + index,
      peer_id: buildPeer(entry.chatId),
      from_id: entry.isOutgoing ? selfPeer : buildPeer(entry.chatId),
      date: entry.date,
      action: isGroup ?
        buildGroupCallAction(entry.outcome) :
        buildPhoneCallAction(entry.callType === 'video', entry.outcome)
    };
  });
  return {_: 'messages.messages', messages, chats: [], users: [], topics: []} as MethodDeclMap['messages.search']['res'];
}

/** Whether a call log row has no notice to show in its chat */
export function getIsNoticelessCallMid(mid: number) {
  return mid >= NOTICELESS_CALL_ID_BASE;
}

// * the tab shows a group call as a conference call, which it calls back only where conference calls work (never here)
function buildGroupCallAction(outcome: string): MessageAction.messageActionConferenceCall {
  return {_: 'messageActionConferenceCall', pFlags: {missed: outcome === 'missed' || undefined}, call_id: '0'};
}

/** Clears the log here and on our other devices; the engine deletes the call notices, which reach Web K as deletions */
async function clearCallLog(host: SignalMethodHost) {
  await host.call('clearCallLog');
  return {_: 'messages.affectedFoundMessages', pts: 0, pts_count: 0, offset: 0, messages: [] as number[]};
}
