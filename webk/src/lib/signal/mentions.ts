/*
 * TeleSignal: the unread mentions of a chat, which Web K's mention button steps through, as Web A's
 * `focusNextMention` does. A Signal mention is read with its message (`readHistory`), so the reads of mentions that
 * Web K sends on their own change nothing in the engine. Web K's read of the history waits a moment before it reaches
 * the engine, so a mention that Web K read already is left out of the engine's answer, which would mark it unread
 * again.
 */

import type {Message, MethodDeclMap, User} from '@layer';
import type {SignalMessage, SignalUser} from '@lib/signal/signalApi';
import type {SignalMethodHandlers, SignalMethodHost} from '@lib/signal/methodHost';
import {toSignalPeerId} from '@lib/signal/builders';

type MentionsResult = {messages: SignalMessage[], users: SignalUser[]};
type BuildMessages = (result: MentionsResult) => {messages: Message[], users: User[]};
type MentionHelpers = {
  buildMessages: BuildMessages,
  /** Whether Web K read the mention of this message, which the engine may not know yet */
  getIsReadHere: (peerId: PeerId, mid: number) => boolean
};

const AFFECTED_MESSAGES = {_: 'messages.affectedMessages', pts: 0, pts_count: 0} as const;

export function buildMentionHandlers(host: SignalMethodHost, helpers: MentionHelpers): SignalMethodHandlers {
  return {
    'messages.getUnreadMentions': (params) => fetchUnreadMentions(host, helpers, params),
    'messages.readMessageContents': () => AFFECTED_MESSAGES,
    'messages.readMentions': () => ({...AFFECTED_MESSAGES, offset: 0})
  };
}

/**
 * A page of unread mentions, newest first, as Telegram pages them: with a negative `add_offset` the oldest ones from
 * `offset_id` on (Web K's next mentions above the newest it holds), otherwise the newest ones below `offset_id`. The
 * provider answers all of them at once
 */
async function fetchUnreadMentions(
  host: SignalMethodHost,
  {buildMessages, getIsReadHere}: MentionHelpers,
  params: MethodDeclMap['messages.getUnreadMentions']['req']
): Promise<MethodDeclMap['messages.getUnreadMentions']['res']> {
  const peerId = host.getInputPeerId(params.peer);
  const result: MentionsResult = await host.call('fetchUnreadMentions', {chat: {id: toSignalPeerId(peerId)}});
  const offsetId = params.offset_id || 0;
  const mentions = (result?.messages ?? [])
  .filter(({id}) => !getIsReadHere(peerId, id))
  .sort((a, b) => b.id - a.id);
  const page = params.add_offset < 0 ?
    mentions.filter(({id}) => id >= offsetId).slice(-params.limit) :
    mentions.filter(({id}) => !offsetId || id < offsetId).slice(0, params.limit);
  const {messages, users} = buildMessages({messages: page, users: result?.users ?? []});
  return {_: 'messages.messages', messages, users, chats: [], topics: []};
}
