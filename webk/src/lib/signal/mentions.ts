/*
 * TeleSignal: the unread mentions of a chat, which Web K's mention button steps through, as Web A's
 * `focusNextMention` does. A Signal mention is read with its message (`readHistory`), so the reads of mentions that
 * Web K sends on their own change nothing in the engine.
 */

import type {Message, MethodDeclMap, User} from '@layer';
import type {SignalMessage, SignalUser} from '@lib/signal/signalApi';
import type {SignalMethodHandlers, SignalMethodHost} from '@lib/signal/methodHost';
import {toSignalPeerId} from '@lib/signal/builders';

type MentionsResult = {messages: SignalMessage[], users: SignalUser[]};
type BuildMessages = (result: MentionsResult) => {messages: Message[], users: User[]};

const AFFECTED_MESSAGES = {_: 'messages.affectedMessages', pts: 0, pts_count: 0} as const;

export function buildMentionHandlers(host: SignalMethodHost, buildMessages: BuildMessages): SignalMethodHandlers {
  return {
    'messages.getUnreadMentions': (params) => fetchUnreadMentions(host, buildMessages, params),
    'messages.readMessageContents': () => AFFECTED_MESSAGES,
    'messages.readMentions': () => ({...AFFECTED_MESSAGES, offset: 0})
  };
}

/**
 * The unread mentions from `offset_id` on, newest first: Web K asks for those newer than the oldest it holds, and
 * the provider answers all of them at once
 */
async function fetchUnreadMentions(
  host: SignalMethodHost,
  buildMessages: BuildMessages,
  params: MethodDeclMap['messages.getUnreadMentions']['req']
): Promise<MethodDeclMap['messages.getUnreadMentions']['res']> {
  const peerId = host.getInputPeerId(params.peer);
  const result: MentionsResult = await host.call('fetchUnreadMentions', {chat: {id: toSignalPeerId(peerId)}});
  const {messages, users} = buildMessages({
    messages: (result?.messages ?? [])
    .filter(({id}) => id >= (params.offset_id || 0))
    .sort((a, b) => b.id - a.id)
    .slice(0, params.limit),
    users: result?.users ?? []
  });
  return {_: 'messages.messages', messages, users, chats: [], topics: []};
}
