import type { ConversationRecord, MessageRecord } from '../../../lib/signal/db/MessageDb';
import type { ThreadReadState } from '../../../types';
import type {
  ApiChat,
  ApiChatAdminRights,
  ApiChatBannedRights,
  ApiChatFullInfo,
  ApiChatMember,
  ApiChatPendingInvite,
  ApiPeerNotifySettings,
  ApiThreadInfo,
  ApiUser,
} from '../../types';
import { MAIN_THREAD_ID } from '../../types';

import { ARCHIVED_FOLDER_ID, MUTE_INDEFINITE_TIMESTAMP } from '../../../config';
import { buildGroupInviteLink } from '../../../lib/signal/groups/inviteLinks';
import { formatMemberLabel } from '../../../lib/signal/groups/memberLabels';
import { AccessControl_AccessRequired } from '../../../lib/signal/proto/generated/Groups_pb';
import { isPniServiceId, toPniServiceId } from '../../../lib/signal/serviceId';
import { buildCollectionByKey } from '../../../util/iteratees';
import { getServerTime } from '../../../util/serverTime';
import { getCurrentAccount } from '../client';
import { db, processor } from '../engine';
import { getPeerId } from '../peers';
import {
  buildApiUser, buildAvatarColor, buildAvatarPhoto, buildPeerSettings, getAvatarPhotoId,
} from './users';

const READ_STATE_PAGE_SIZE = 50;
const MS_PER_SECOND = 1000;
// Signal group admins edit the group, add and remove members and admins, pin messages and delete them for everyone
const GROUP_ADMIN_RIGHTS: ApiChatAdminRights = {
  changeInfo: true,
  deleteMessages: true,
  banUsers: true,
  inviteUsers: true,
  pinMessages: true,
  addAdmins: true,
  manageRanks: true,
};

/**
 * Builds the chat of a conversation. Private conversations are chats with the user's id; groups are basic
 * groups. A group we are no longer a member of keeps its history but cannot be written to, as in Signal.
 * A group we are invited to is not joined until we accept.
 */
export function buildApiChat(conversation: ConversationRecord, selfAci: string): ApiChat {
  const id = getPeerId(conversation);
  const folderId = conversation.isArchived ? ARCHIVED_FOLDER_ID : undefined;
  const avatarPhotoId = getAvatarPhotoId(conversation);
  const color = buildAvatarColor(conversation);
  const isListed = getIsChatListed(conversation, selfAci);

  if (conversation.type === 'private') {
    const { firstName, lastName, usernames, hasUsername } = buildApiUser(conversation, selfAci);
    return {
      id,
      type: 'chatTypePrivate',
      title: [firstName, lastName].filter(Boolean).join(' '),
      folderId,
      avatarPhotoId,
      color,
      usernames,
      hasUsername,
      ttlPeriod: conversation.expireTimer,
      isListed,
    };
  }

  const { memberAcis, adminAcis } = conversation;
  const isInvited = getIsInvitedToGroup(conversation, selfAci);
  // An ended group keeps its history, and nobody can write to it, as to a group we left
  const isTerminated = Boolean(conversation.groupState?.isTerminated);
  return {
    id,
    type: 'chatTypeBasicGroup',
    title: conversation.title ?? '',
    folderId,
    avatarPhotoId,
    color,
    membersCount: memberAcis?.length,
    ttlPeriod: conversation.expireTimer,
    isListed,
    isForbidden: isTerminated || (memberAcis && !memberAcis.includes(selfAci) && !isInvited) ? true : undefined,
    isNotJoined: isInvited || undefined,
    adminRights: adminAcis?.includes(selfAci) ? GROUP_ADMIN_RIGHTS : undefined,
    defaultBannedRights: buildGroupBannedRights(conversation),
    areStoriesHidden: conversation.isStoryHidden || undefined,
  };
}

/** Whether we are invited to a group, by our ACI or our PNI, and have not accepted or declined yet */
export function getIsInvitedToGroup(conversation: ConversationRecord, selfAci: string) {
  const pni = getCurrentAccount()?.pni;
  const selfPni = pni && toPniServiceId(pni);
  return Boolean(conversation.groupState?.pendingMembers.some(({ serviceId }) => (
    serviceId === selfAci || serviceId === selfPni
  )));
}

/**
 * What members other than admins may not do: send messages in announcement-only groups, and edit the group, pin
 * messages (Signal Desktop `canPinMessages`) or add members when only admins may
 */
function buildGroupBannedRights({ isAnnouncementsOnly, groupState }: ConversationRecord) {
  const isInfoAdminOnly = groupState?.accessControl.attributes === AccessControl_AccessRequired.ADMINISTRATOR;
  const isMembersAdminOnly = groupState?.accessControl.members === AccessControl_AccessRequired.ADMINISTRATOR;
  const isLabelAdminOnly = groupState?.accessControl.memberLabel === AccessControl_AccessRequired.ADMINISTRATOR;
  if (!isAnnouncementsOnly && !isInfoAdminOnly && !isMembersAdminOnly && !isLabelAdminOnly) return undefined;
  return {
    sendMessages: isAnnouncementsOnly || undefined,
    changeInfo: isInfoAdminOnly || undefined,
    pinMessages: isInfoAdminOnly || undefined,
    inviteUsers: isMembersAdminOnly || undefined,
    editRank: isLabelAdminOnly || undefined,
  } satisfies ApiChatBannedRights;
}

/** The group link while it is on (Signal Desktop `buildGroupLink`) */
export function getGroupInviteLink({ masterKey, groupState }: ConversationRecord) {
  const isLinkOn = groupState?.inviteLinkPassword
    && groupState.accessControl.addFromInviteLink !== AccessControl_AccessRequired.UNSATISFIABLE;
  return isLinkOn ? buildGroupInviteLink(masterKey!, groupState.inviteLinkPassword!) : undefined;
}

/**
 * Whether a conversation is in the chat list. Signal Desktop lists conversations with `active_at`, which
 * messages and joining a group set and blocking keeps, so a blocked conversation stays only while it has
 * messages (`ts/state/selectors/conversations.dom.ts`, `_getLeftPaneLists`). Pinned conversations always show.
 */
export function getIsChatListed(conversation: ConversationRecord, selfAci: string) {
  if (conversation.lastMessageId !== undefined || conversation.pinIndex !== undefined) return true;
  return conversation.type === 'group' && !conversation.isBlocked
    && (Boolean(conversation.memberAcis?.includes(selfAci)) || getIsInvitedToGroup(conversation, selfAci));
}

/** Pinned conversations in pin order */
export function getPinnedConversations(conversations: ConversationRecord[]) {
  return conversations
    .filter(({ pinIndex }) => pinIndex !== undefined)
    .sort((a, b) => a.pinIndex! - b.pinIndex!);
}

/** The mute state in seconds; Signal stores milliseconds and mutes forever with a time far in the future */
export function buildNotifySettings(conversation: ConversationRecord): ApiPeerNotifySettings {
  const { mutedUntil } = conversation;
  const isMuted = mutedUntil !== undefined && mutedUntil > getServerTime() * 1000;
  return {
    mutedUntil: isMuted ? Math.min(Math.floor(mutedUntil / 1000), MUTE_INDEFINITE_TIMESTAMP) : undefined,
  };
}

export function buildThreadInfo(chatId: string, lastMessageId?: number): ApiThreadInfo {
  return {
    isCommentsInfo: false,
    chatId,
    threadId: MAIN_THREAD_ID,
    lastMessageId,
  };
}

/**
 * The read state of a chat. The last read incoming message is the one before the oldest unread message,
 * and the last read outgoing message is the newest one a recipient read among the scanned pages.
 * Reading marks every earlier message read, so unread messages are the newest ones and a few pages suffice.
 */
export async function buildThreadReadState(conversation: ConversationRecord): Promise<ThreadReadState> {
  let unreadLeft = conversation.unreadCount;
  let lastReadInboxMessageId: number | undefined;
  let lastReadOutboxMessageId: number | undefined;
  let beforeId: number | undefined;
  let isDone = false;

  while (!isDone) {
    const page = await db.getMessages(conversation.id, READ_STATE_PAGE_SIZE, beforeId);
    for (const message of page) {
      if (lastReadOutboxMessageId === undefined && getIsReadByRecipient(message)) {
        lastReadOutboxMessageId = message.id;
      }
      if (lastReadInboxMessageId !== undefined) continue;
      if (!unreadLeft) {
        lastReadInboxMessageId = message.id;
      } else if (getIsUnreadIncoming(message)) {
        unreadLeft--;
      }
    }
    beforeId = page[page.length - 1]?.id;
    isDone = page.length < READ_STATE_PAGE_SIZE || lastReadInboxMessageId !== undefined;
  }

  return {
    unreadCount: conversation.unreadCount,
    hasUnreadMark: Boolean(conversation.isMarkedUnread),
    lastReadInboxMessageId,
    lastReadOutboxMessageId,
  };
}

/** Signal shows an outgoing message as read once any recipient read it */
export function getIsReadByRecipient(message: MessageRecord) {
  return message.isOutgoing && Object.values(message.recipientStatus ?? {})
    .some((status) => status === 'read' || status === 'viewed');
}

/** Group details with members; members seen for the first time get user records */
export async function buildGroupFullInfo(
  conversation: ConversationRecord, selfAci: string,
): Promise<{ fullInfo: ApiChatFullInfo; users: ApiUser[] }> {
  const memberConversations: ConversationRecord[] = [];
  for (const aci of conversation.memberAcis ?? []) {
    memberConversations.push(await processor.getOrCreatePrivateConversation(aci));
  }

  const adminAcis = new Set(conversation.adminAcis);
  const isSelfAdmin = adminAcis.has(selfAci);
  const requesters = isSelfAdmin ? conversation.groupState?.requestingMembers ?? [] : [];
  const requesterConversations: ConversationRecord[] = [];
  for (const { aci } of requesters) {
    requesterConversations.push(await processor.getOrCreatePrivateConversation(aci));
  }
  // Admins see who was invited and by whom; the others have no use for it
  const pendingMembers = isSelfAdmin ? conversation.groupState?.pendingMembers ?? [] : [];
  const invitedConversations = new Map<string, ConversationRecord>();
  for (const serviceId of new Set(pendingMembers.flatMap(({ serviceId: invited, addedBy }) => [invited, addedBy]))) {
    if (serviceId && !isPniServiceId(serviceId)) {
      invitedConversations.set(serviceId, await processor.getOrCreatePrivateConversation(serviceId));
    }
  }
  const invitedNumbers = pendingMembers.some(({ serviceId }) => isPniServiceId(serviceId))
    ? await processor.getInvitedNumbers()
    : undefined;
  const pendingInvites = pendingMembers.map(({ serviceId, addedBy, timestamp }): ApiChatPendingInvite => {
    const invited = invitedConversations.get(serviceId);
    const inviter = addedBy ? invitedConversations.get(addedBy) : undefined;
    return {
      serviceId,
      userId: invited && getPeerId(invited),
      phoneNumber: invitedNumbers?.[serviceId],
      inviterId: inviter && getPeerId(inviter),
      date: timestamp ? Math.floor(timestamp / MS_PER_SECOND) : undefined,
    };
  });
  // Admins see who was removed from the group and can unban them; a ban names no one who removed the member
  const bannedConversations: ConversationRecord[] = [];
  for (const { serviceId } of isSelfAdmin ? conversation.groupState?.bannedMembers ?? [] : []) {
    if (!isPniServiceId(serviceId)) bannedConversations.push(await processor.getOrCreatePrivateConversation(serviceId));
  }
  const labels = new Map(conversation.groupState?.members.map((member) => [member.aci, formatMemberLabel(member)]));
  const members = memberConversations.map((member): ApiChatMember => {
    const isMemberAdmin = adminAcis.has(member.id);
    return {
      userId: getPeerId(member),
      rank: labels.get(member.id),
      isAdmin: isMemberAdmin ? true : undefined,
      adminRights: isMemberAdmin ? GROUP_ADMIN_RIGHTS : undefined,
    };
  });

  return {
    fullInfo: {
      settings: buildPeerSettings(conversation, selfAci),
      about: conversation.description,
      profilePhoto: buildAvatarPhoto(conversation),
      ttlPeriod: conversation.expireTimer,
      members,
      adminMembersById: buildCollectionByKey(members.filter(({ isAdmin }) => isAdmin), 'userId'),
      canViewMembers: true,
      // Signal allows any emoji as a reaction
      enabledReactions: { type: 'all' },
      // New members of Signal groups do not see earlier messages
      isPreHistoryHidden: true,
      inviteLink: getGroupInviteLink(conversation),
      requestsPending: requesters.length || undefined,
      recentRequesterIds: requesterConversations.length ? requesterConversations.map(getPeerId) : undefined,
      pendingInvites: pendingInvites.length ? pendingInvites : undefined,
      kickedMembers: bannedConversations.length
        ? bannedConversations.map((banned) => ({ userId: getPeerId(banned), bannedRights: { viewMessages: true } }))
        : undefined,
    },
    users: [
      ...memberConversations, ...requesterConversations, ...invitedConversations.values(), ...bannedConversations,
    ]
      .map((member) => buildApiUser(member, selfAci)),
  };
}

// Mirrors `MessageDb.getUnreadMessages`
function getIsUnreadIncoming(message: MessageRecord) {
  return !message.isOutgoing && !message.readAt && message.kind === 'message';
}
