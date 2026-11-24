import type { CallRecord, ConversationRecord } from '../../../lib/signal/db/MessageDb';
import type { ApiCallLogEntry, ApiCallLogOutcome } from '../../types';

import { getPeerId } from '../peers';

const MS_PER_SECOND = 1000;

/**
 * What became of the call: the statuses of Signal Desktop `CallStatusValue` that mean the same to the person. A
 * group call that was joined counts as accepted; one that started or rings and was not joined is still pending.
 */
export function getCallOutcome({ status }: CallRecord): ApiCallLogOutcome {
  switch (status) {
    case 'accepted':
    case 'joined':
    case 'outgoingRing':
      return 'accepted';
    case 'declined':
      return 'declined';
    case 'missed':
      return 'missed';
    default:
      return 'pending';
  }
}

/** The call log entry of a call in a conversation */
export function buildApiCallLogEntry(call: CallRecord, conversation: ConversationRecord): ApiCallLogEntry {
  return {
    id: call.callId,
    chatId: getPeerId(conversation),
    callType: call.type,
    isOutgoing: call.direction === 'outgoing',
    outcome: getCallOutcome(call),
    date: Math.floor(call.timestamp / MS_PER_SECOND),
    isUnseen: call.isUnseen,
    messageId: call.messageId,
  };
}
