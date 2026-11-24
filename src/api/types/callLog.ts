export type ApiCallLogType = 'audio' | 'video' | 'group';

/** What became of a call: `pending` calls are ringing or started and not answered on this device's behalf yet */
export type ApiCallLogOutcome = 'pending' | 'accepted' | 'declined' | 'missed';

/** A call of the Signal call history; calls cannot be made or answered here, so it only shows them */
export interface ApiCallLogEntry {
  // The id of the call, unique within its chat
  id: string;
  chatId: string;
  callType: ApiCallLogType;
  isOutgoing: boolean;
  outcome: ApiCallLogOutcome;
  // Seconds
  date: number;
  // A missed incoming call that the call log did not mark as read
  isUnseen?: true;
  // The call's notice in its chat, when it has one
  messageId?: number;
}
