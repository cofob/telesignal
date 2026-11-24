/*
 * TeleSignal: how an outgoing message reached each recipient, for the message info popup of Web K
 * (`components/popups/messageInfo.tsx`), as Web A's message details show it.
 */

import type {SignalMethodHost} from '@lib/signal/methodHost';
import {toPeerId, toSignalPeerId} from '@lib/signal/builders';
import getServerMessageId from '@appManagers/utils/messageId/getServerMessageId';

export type MessageRecipientStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'viewed' | 'failed';
export type MessageRecipient = {peerId: PeerId, status: MessageRecipientStatus};

/** The recipients of an outgoing message with their send status, or `undefined` for a message that is not ours */
export async function fetchMessageRecipients(host: SignalMethodHost, peerId: PeerId, mid: number): Promise<MessageRecipient[] | undefined> {
  const result: {recipients: {userId: string, status: MessageRecipientStatus}[]} | undefined = await host.call(
    'fetchMessageSendDetails',
    {chat: {id: toSignalPeerId(peerId)}, messageId: getServerMessageId(mid)}
  );
  return result?.recipients.map(({userId, status}) => ({peerId: toPeerId(userId), status}));
}
