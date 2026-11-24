/*
 * TeleSignal: pinned messages of Web K. A Signal pin is for everyone in the chat; the provider sends each pin and
 * unpin as a data message, and the pins of a chat arrive back as `updatePinnedIds`.
 */

import type {MethodDeclMap, Update, Updates} from '@layer';
import type {SignalMethodHandlers, SignalMethodHost} from '@lib/signal/methodHost';
import {buildPeer, toSignalPeerId} from '@lib/signal/builders';
import makeError from '@helpers/makeError';
import tsNow from '@helpers/tsNow';

export function buildPinnedMessageHandlers(host: SignalMethodHost): SignalMethodHandlers {
  return {
    'messages.updatePinnedMessage': (params: MethodDeclMap['messages.updatePinnedMessage']['req']) => updatePinnedMessage(host, params),
    'messages.unpinAllMessages': (params: MethodDeclMap['messages.unpinAllMessages']['req']) => unpinAllMessages(host, params)
  };
}

/** The pinned messages of a chat, newest pin first, as the provider builds them */
export async function fetchPinnedMessages(host: SignalMethodHost, peerId: PeerId) {
  const result: {messages: any[]} | undefined = await host.call('fetchPinnedMessages', {chat: {id: toSignalPeerId(peerId)}});
  return result?.messages ?? [];
}

/** The pins and unpins of a chat as Web K's update */
export function buildPinnedMessagesUpdate(chatId: string, messageIds: number[], isPinned?: boolean): Update.updatePinnedMessages {
  return {
    _: 'updatePinnedMessages',
    pFlags: {pinned: isPinned || undefined},
    peer: buildPeer(chatId),
    messages: messageIds,
    pts: 0,
    pts_count: 0
  };
}

async function updatePinnedMessage(host: SignalMethodHost, params: MethodDeclMap['messages.updatePinnedMessage']['req']) {
  const peerId = host.getInputPeerId(params.peer);
  const result = peerId && await host.call('pinMessage', {
    chat: {id: toSignalPeerId(peerId)},
    messageId: params.id,
    isUnpin: !!params.unpin
  });
  if(!result) throw makeError('SIGNAL_SEND_FAILED' as ErrorType);

  // * the pin itself comes back as `updatePinnedIds`, which the adapter turns into `updatePinnedMessages`
  return {_: 'updates', updates: [], users: [], chats: [], date: tsNow(true), seq: 0} as Updates;
}

async function unpinAllMessages(host: SignalMethodHost, params: MethodDeclMap['messages.unpinAllMessages']['req']) {
  const peerId = host.getInputPeerId(params.peer);
  const result = peerId && await host.call('unpinAllMessages', {chat: {id: toSignalPeerId(peerId)}});
  if(!result) throw makeError('SIGNAL_SEND_FAILED' as ErrorType);
  return {_: 'messages.affectedHistory', pts: 0, pts_count: 0, offset: 0};
}
