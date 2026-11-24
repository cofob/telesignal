import type { ConversationRecord, MessageRecord } from '../db/MessageDb';

import { AccessControl_AccessRequired } from '../proto/generated/Groups_pb';

export type PinnedMessageEntry = NonNullable<ConversationRecord['pinnedMessages']>[number];

// The default of the remote config `global.pinnedMessageLimit` (Signal Desktop `ts/util/pinnedMessages.std.ts`)
export const PINNED_MESSAGES_LIMIT = 3;

/**
 * Whether a member may pin and unpin messages: anyone in a private chat, and in a group whoever may edit the group
 * (Signal Desktop `canSenderEditGroupAttributes` in `ts/messageModifiers/PinnedMessages.preload.ts` and
 * `canPinMessages` in `ts/state/selectors/message.preload.ts`)
 */
export function getCanPinMessages(conversation: ConversationRecord, aci: string) {
  if (conversation.type === 'private') return true;
  if (conversation.groupState?.isTerminated || !conversation.memberAcis?.includes(aci)) return false;
  return Boolean(conversation.adminAcis?.includes(aci))
    || conversation.groupState?.accessControl.attributes === AccessControl_AccessRequired.MEMBER;
}

/** Whether a message can be pinned: a message that is not deleted for everyone */
export function getIsMessagePinnable(message: MessageRecord) {
  return message.kind === 'message' && !message.deletedAt;
}

/**
 * The pins of a chat after a pin: a newer pin of the message replaces its older one, expired pins go, and the chat
 * keeps its newest `PINNED_MESSAGES_LIMIT` pins (Signal Desktop `appendPinnedMessage` in
 * `ts/sql/server/pinnedMessages.std.ts`)
 */
export function addPinnedMessage(pins: PinnedMessageEntry[] = [], pin: PinnedMessageEntry, now: number) {
  const existing = pins.find(({ messageId }) => messageId === pin.messageId);
  if (existing && existing.pinnedAt >= pin.pinnedAt) return pins;
  const others = pins.filter(({ messageId, expiresAt }) => (
    messageId !== pin.messageId && (!expiresAt || expiresAt > now)
  ));
  return [...others, pin]
    .sort((a, b) => b.pinnedAt - a.pinnedAt)
    .slice(0, PINNED_MESSAGES_LIMIT);
}

/**
 * The pins of `current` with a change from `previous` to `changed` taken back: the pins it added go and the pins it
 * removed come back, and whatever else changed meanwhile stays
 */
export function revertPinChange(
  current: PinnedMessageEntry[] = [], previous: PinnedMessageEntry[] = [], changed: PinnedMessageEntry[] = [],
) {
  const isSame = (a: PinnedMessageEntry, b: PinnedMessageEntry) => (
    a.messageId === b.messageId && a.pinnedAt === b.pinnedAt
  );
  const added = changed.filter((pin) => !previous.some((other) => isSame(pin, other)));
  const removed = previous.filter((pin) => !changed.some((other) => isSame(pin, other)));
  return [
    ...current.filter((pin) => !added.some((other) => isSame(pin, other))),
    ...removed.filter((pin) => !current.some(({ messageId }) => messageId === pin.messageId)),
  ];
}

/** The pins of a chat that have not expired, newest first */
export function getActivePinnedMessages({ pinnedMessages }: ConversationRecord, now: number) {
  return (pinnedMessages ?? [])
    .filter(({ expiresAt }) => !expiresAt || expiresAt > now)
    .sort((a, b) => b.pinnedAt - a.pinnedAt);
}
