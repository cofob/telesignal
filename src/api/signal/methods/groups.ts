import type { ConversationRecord } from '../../../lib/signal/db/MessageDb';
import type { GroupChangeBuilder } from '../../../lib/signal/groups/buildGroupChange';
import type {
  ApiAvatarUpload,
  ApiChat,
  ApiChatAdminRights,
  ApiChatBannedRights,
  ApiChatInviteImporter,
  ApiExportedInvite,
  ApiMissingInvitedUser,
  ApiPeer,
  ApiPhoto,
  ApiUser,
} from '../../types';

import { CdsiError } from '../../../lib/signal/cdsi/cdsiLookup';
import {
  buildAcceptInvitationChange,
  buildAccessChange,
  buildAddMembersChange,
  buildAnnouncementsOnlyChange,
  buildDescriptionChange,
  buildExpireTimerChange,
  buildInviteLinkChange,
  buildJoinRequestChange,
  buildLeaveChange,
  buildMemberLabelChange,
  buildRemoveMemberChange,
  buildRoleChange,
  buildTerminateChange,
  buildTitleChange,
  buildUnbanChange,
  checkGroupDescription,
  checkGroupTitle,
  combineGroupChanges,
  GroupChangeRefusedError,
} from '../../../lib/signal/groups/buildGroupChange';
import { GroupRequestError } from '../../../lib/signal/groups/fetchGroup';
import { parseMemberLabel } from '../../../lib/signal/groups/memberLabels';
import { AccessControl_AccessRequired } from '../../../lib/signal/proto/generated/Groups_pb';
import { isPniServiceId } from '../../../lib/signal/serviceId';
import { buildCollectionByKey } from '../../../util/iteratees';
import { buildApiChat, getGroupInviteLink } from '../builders/chats';
import { buildApiUser } from '../builders/users';
import { getCurrentAccount } from '../client';
import {
  db, groups, logError, processor,
} from '../engine';
import { getConversationByPeerId, getPeerId, getUserPeerId } from '../peers';
import { sendApiUpdate } from '../updates';

// Error keys of `getReadableErrorText`
const GROUP_CHANGE_ERROR = 'SIGNAL_GROUP_CHANGE_FAILED';
const INVITE_LINK_ERROR = 'INVITE_HASH_EXPIRED';
const REFUSED_CHANGE_ERRORS = {
  titleTooLong: 'SIGNAL_GROUP_TITLE_TOO_LONG',
  descriptionTooLong: 'SIGNAL_GROUP_DESCRIPTION_TOO_LONG',
  lastAdmin: 'SIGNAL_GROUP_LAST_ADMIN',
  labelTooLong: 'SIGNAL_GROUP_LABEL_TOO_LONG',
} as const;
const E164_PATTERN = /^\+[1-9]\d{6,14}$/;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;

const reportedErrors = new WeakSet<Error>();

/**
 * Creates a Signal group with us as its admin. Users we cannot add yet, for lack of their profile key, are
 * invited and join once they accept, so none are missing.
 */
export async function createGroupChat({ title, users }: { title: string; users: ApiUser[] }) {
  const selfAci = getCurrentAccount()?.aci;
  if (!selfAci) return undefined;

  try {
    const conversation = await groups.createGroup({ title, memberAcis: await getAcis(users) });
    return { chat: buildApiChat(conversation, selfAci), missingUsers: [] as ApiMissingInvitedUser[] };
  } catch (err) {
    reportError(err);
    return undefined;
  }
}

export async function updateChatTitle(chat: ApiChat, title: string) {
  await changeGroup(chat, buildTitleChange(title), { check: () => checkGroupTitle(title) });
}

export async function updateChatAbout(chat: ApiChat, about: string) {
  await changeGroup(chat, buildDescriptionChange(about), { check: () => checkGroupDescription(about) });
}

/** Sets a new group avatar, or removes it without `photo`; earlier avatars cannot be chosen again in Signal */
export async function editChatPhoto({ chat, photo }: { chat: ApiChat; photo?: ApiAvatarUpload | ApiPhoto }) {
  if (photo && 'mediaType' in photo) return false;
  const conversation = await getGroupConversation(chat);
  if (!conversation) return false;

  try {
    const avatar = photo && new Uint8Array(await photo.file.arrayBuffer());
    await groups.setAvatar(conversation.id, avatar);
    return true;
  } catch (err) {
    reportError(err);
    return false;
  }
}

/** Disappearing message timers of groups are part of the group state; those of private chats are sent to the contact */
export async function setHistoryTtl({ peer, period }: { peer: ApiPeer; period: number }) {
  const conversation = await getConversationByPeerId(peer.id);
  if (conversation?.type === 'private') {
    try {
      await processor.setExpireTimer(conversation.id, period);
      return true as const;
    } catch (err) {
      logError(err);
      return undefined;
    }
  }
  if (!conversation) return undefined;
  return changeGroup(peer, buildExpireTimerChange(period));
}

/** Members we cannot add yet are invited, so the result has no missing users */
export async function addChatMembers(chat: ApiChat, users: ApiUser[]) {
  const isChanged = await changeGroup(chat, buildAddMembersChange(await getAcis(users)));
  return isChanged ? [] as ApiMissingInvitedUser[] : undefined;
}

/**
 * Adds the user of a phone number to the group, or invites them when they have no profile key we know. A user the
 * contact discovery service knows by PNI only is invited by PNI; the invitation turns into a membership when they
 * accept. Each new number counts against the lookup rate limit, so this runs for a number the user chose.
 */
export async function addChatMemberByPhoneNumber({ chat, phoneNumber }: { chat: ApiChat; phoneNumber: string }) {
  const e164 = `+${phoneNumber.replace(/\D/g, '')}`;
  if (!E164_PATTERN.test(e164)) return { error: 'notFound' as const };

  try {
    const resolved = await processor.resolvePhoneNumber(e164);
    const serviceId = resolved?.conversation?.id ?? resolved?.pniServiceId;
    if (!serviceId) return { error: 'notFound' as const };
    const isChanged = await changeGroup(chat, buildAddMembersChange([serviceId]));
    if (isChanged && resolved?.pniServiceId) await processor.saveInvitedNumber(resolved.pniServiceId, e164);
    return isChanged ? { status: isPniServiceId(serviceId) ? 'invited' as const : 'added' as const } : undefined;
  } catch (err) {
    if (err instanceof CdsiError && err.reason === 'rateLimited') return { error: 'rateLimited' as const };
    logError(err);
    return { error: 'unavailable' as const };
  }
}

/** Takes back an invitation, by the ACI or PNI it names */
export function revokeChatInvite({ chat, serviceId }: { chat: ApiChat; serviceId: string }) {
  return changeGroup(chat, buildRemoveMemberChange(serviceId));
}

/** Removing a member also bans them from joining through the group link, as Signal clients do */
export async function deleteChatMember(chat: ApiChat, user: ApiUser) {
  const [aci] = await getAcis([user]);
  return aci ? changeGroup(chat, buildRemoveMemberChange(aci, true)) : undefined;
}

/** Leaves the group when `user` is us, or declines our invitation or join request; removes the member otherwise */
export async function deleteChatUser({ chat, user }: { chat: ApiChat; user: ApiUser; shouldRevokeHistory?: boolean }) {
  if (user.isSelf) return changeGroup(chat, buildLeaveChange());
  return deleteChatMember(chat, user);
}

/** Signal groups cannot be deleted for everyone, so deleting one leaves it */
export async function deleteChat({ chatId }: { chatId: string }) {
  const conversation = await getConversationByPeerId(chatId);
  if (conversation?.type !== 'group') return undefined;
  return changeGroup({ id: chatId }, buildLeaveChange());
}

/** Ends the group for everyone; it stays in the list with its history (Signal Desktop `terminateGroup`) */
export function terminateChat({ chat }: { chat: ApiChat }) {
  return changeGroup(chat, buildTerminateChange());
}

/**
 * Sets our own label in the group, which Signal shows beside the name; no `rank` removes it. Signal clients set
 * only their own label, so `peer` must be us. A leading emoji is the emoji of the label.
 */
export async function editChatParticipantRank({ chat, peer, rank }: { chat: ApiChat; peer: ApiPeer; rank: string }) {
  const selfAci = getCurrentAccount()?.aci;
  if (!selfAci || peer.id !== await getUserPeerId(selfAci)) return undefined;
  return changeGroup(chat, buildMemberLabelChange(selfAci, parseMemberLabel(rank)));
}

/** Signal admins have every admin right, so any right makes the member an admin and none makes them a member */
export async function updateChatAdmin({
  chat, user, adminRights,
}: { chat: ApiChat; user: ApiUser; adminRights: ApiChatAdminRights; rank?: string }) {
  const [aci] = await getAcis([user]);
  if (!aci) return undefined;
  return changeGroup(chat, buildRoleChange(aci, Object.values(adminRights).some(Boolean)));
}

/**
 * Maps the default rights to Signal's: banned sending makes the group announcement-only, and banned info
 * changes, invites or labels leave them to admins. Other rights have no Signal counterpart.
 */
export function updateChatDefaultBannedRights({
  chat, bannedRights,
}: { chat: ApiChat; bannedRights: ApiChatBannedRights }) {
  return changeGroup(chat, combineGroupChanges(
    buildAnnouncementsOnlyChange(Boolean(bannedRights.sendMessages)),
    buildAccessChange({
      isInfoAdminOnly: Boolean(bannedRights.changeInfo),
      isMembersAdminOnly: Boolean(bannedRights.inviteUsers),
      isLabelAdminOnly: Boolean(bannedRights.editRank),
    }),
  ));
}

/** Banning removes the member and keeps them from rejoining; lifting every right unbans */
export async function updateChatMemberBannedRights({
  chat, peer, bannedRights,
}: { chat: ApiChat; peer: ApiPeer; bannedRights: ApiChatBannedRights; untilDate?: number }) {
  const aci = (await getConversationByPeerId(peer.id))?.id;
  if (!aci) return undefined;
  if (bannedRights.viewMessages) return changeGroup(chat, buildRemoveMemberChange(aci, true));
  return Object.keys(bannedRights).length ? undefined : changeGroup(chat, buildUnbanChange(aci));
}

/** A Signal group has one link; its approval setting follows `isEnabled` */
export async function toggleJoinRequest({ chat, isEnabled }: {
  chat: ApiChat; isEnabled: boolean; shouldApplyToInvites?: boolean;
}) {
  const conversation = await getGroupConversation(chat);
  if (!conversation) return undefined;
  return changeGroup(chat, buildInviteLinkChange({
    isEnabled: Boolean(getGroupInviteLink(conversation)), isApprovalRequired: isEnabled,
  }));
}

/** The group link, while it is on, is the only invite of a Signal group; revoked links are not kept */
export async function fetchExportedChatInvites({
  peer, isRevoked,
}: { peer: ApiChat; admin: ApiUser; limit?: number; isRevoked?: boolean }) {
  const conversation = await getGroupConversation(peer);
  if (!conversation) return undefined;
  const invite = !isRevoked ? await buildApiInvite(conversation) : undefined;
  return { invites: invite ? [invite] : [] };
}

/** Turns the group link on; new links of a Signal group are the same link with or without admin approval */
export async function exportChatInvite({
  peer, isRequestNeeded,
}: {
  peer: ApiChat; expireDate?: number; usageLimit?: number; isRequestNeeded?: boolean; title?: string;
}) {
  const isChanged = await changeGroup(peer, buildInviteLinkChange({
    isEnabled: true, isApprovalRequired: isRequestNeeded,
  }));
  const conversation = isChanged && await getGroupConversation(peer);
  return conversation ? buildApiInvite(conversation) : undefined;
}

/** Revoking resets the link, so earlier links stop working; editing sets whether joining needs approval */
export async function editExportedChatInvite({
  peer, isRevoked, link, isRequestNeeded,
}: {
  peer: ApiChat;
  isRevoked?: boolean;
  link: string;
  expireDate?: number;
  usageLimit?: number;
  isRequestNeeded?: boolean;
  title?: string;
}) {
  const before = await getGroupConversation(peer);
  const oldInvite = before && await buildApiInvite(before);
  if (!oldInvite || oldInvite.link !== link) return undefined;

  const isChanged = await changeGroup(peer, buildInviteLinkChange({
    isEnabled: true,
    isApprovalRequired: isRevoked ? oldInvite.isRequestNeeded : isRequestNeeded,
    shouldReset: isRevoked,
  }));
  const after = isChanged && await getGroupConversation(peer);
  const newInvite = after && await buildApiInvite(after);
  if (!newInvite) return undefined;
  return { oldInvite: isRevoked ? { ...oldInvite, isRevoked: true } : newInvite, newInvite };
}

/** Turns the group link off; turned on again (`exportChatInvite`), the same link works again */
export function disableChatInvite({ peer }: { peer: ApiChat }) {
  return changeGroup(peer, buildInviteLinkChange({ isEnabled: false }));
}

/** Revoked links are not kept, so there is nothing to delete */
export function deleteExportedChatInvite() {
  return Promise.resolve(true as const);
}

export function deleteRevokedExportedChatInvites() {
  return Promise.resolve(true as const);
}

/** Join requests of the group link; Signal does not record who joined through it */
export async function fetchChatInviteImporters({
  peer, isRequested,
}: {
  peer: ApiChat; link?: string; offsetDate?: number; offsetUser?: ApiUser; limit?: number; isRequested?: boolean;
}) {
  const selfAci = getCurrentAccount()?.aci;
  const conversation = await getGroupConversation(peer);
  if (!selfAci || !conversation) return undefined;

  const requests = isRequested ? conversation.groupState?.requestingMembers ?? [] : [];
  const requesters = await Promise.all(requests.map(({ aci }) => processor.getOrCreatePrivateConversation(aci)));
  sendApiUpdate({
    '@type': 'updateEntities',
    users: buildCollectionByKey(requesters.map((requester) => buildApiUser(requester, selfAci)), 'id'),
  });
  return {
    importers: requests.map(({ timestamp }, index): ApiChatInviteImporter => ({
      userId: getPeerId(requesters[index]),
      date: Math.floor((timestamp ?? 0) / 1000),
      isRequested: true,
    })),
  };
}

/** Approves a join request, or denies it and bans the requester */
export async function hideChatJoinRequest({
  peer, user, isApproved,
}: { peer: ApiChat; user: ApiUser; isApproved: boolean }) {
  const [aci] = await getAcis([user]);
  return aci ? changeGroup(peer, buildJoinRequestChange(aci, isApproved)) : undefined;
}

export async function hideAllChatJoinRequests({
  peer, isApproved,
}: { peer: ApiChat; isApproved: boolean; link?: string }) {
  const conversation = await getGroupConversation(peer);
  const requests = conversation?.groupState?.requestingMembers ?? [];
  if (!requests.length) return undefined;
  const changes = requests.map(({ aci }) => buildJoinRequestChange(aci, isApproved));
  return changeGroup(peer, combineGroupChanges(...changes));
}

/**
 * What a group link (`https://signal.group/#...`, passed whole as `hash`) shows before joining, or the chat
 * when we are already a member
 */
export async function checkChatInvite(hash: string) {
  const selfAci = getCurrentAccount()?.aci;
  if (!selfAci) return undefined;

  try {
    const preview = await groups.previewGroupLink(hash);
    const conversation = preview.conversationId ? await db.getConversation(preview.conversationId) : undefined;
    if (conversation?.memberAcis?.includes(selfAci)) {
      return { chat: buildApiChat(conversation, selfAci), invite: undefined, users: undefined };
    }
    return {
      chat: undefined,
      invite: {
        title: preview.title ?? '',
        about: preview.description,
        participantsCount: preview.memberCount,
        color: 0,
        isRequestNeeded: preview.isApprovalRequired || undefined,
      },
      users: undefined,
    };
  } catch (err) {
    reportError(err, INVITE_LINK_ERROR);
    return undefined;
  }
}

/**
 * Joins through a group link; a link that needs admin approval sends a join request, which the result tells apart
 * from a failure, and returns no chat yet
 */
export async function importChatInvite({ hash }: { hash: string; theme?: unknown }) {
  const selfAci = getCurrentAccount()?.aci;
  if (!selfAci) return undefined;

  try {
    const conversation = await groups.joinGroupByLink(hash);
    if (conversation.memberAcis?.includes(selfAci)) {
      return { type: 'ok' as const, chat: buildApiChat(conversation, selfAci) };
    }
    return conversation.groupState?.requestingMembers.some((member) => member.aci === selfAci)
      ? { type: 'requested' as const }
      : undefined;
  } catch (err) {
    reportError(err, INVITE_LINK_ERROR);
    return undefined;
  }
}

/** Accepts our invitation to a group */
export async function joinChannel({ channelId }: { channelId: string; accessHash: string; theme?: unknown }) {
  const isChanged = await changeGroup({ id: channelId }, buildAcceptInvitationChange());
  return isChanged ? { type: 'ok' as const } : undefined;
}

/**
 * Runs a change of the group behind `chat`; returns `true` once it is applied and `undefined` when it fails.
 * Edits of the title, description and avatar made together go as one change; they pass `check`, which refuses a
 * value over its limit before it joins the others, so that it does not keep them from being applied.
 */
async function changeGroup(
  chat: Pick<ApiChat, 'id'>, build: GroupChangeBuilder, { check }: { check?: () => void } = {},
) {
  const conversation = await getGroupConversation(chat);
  if (!conversation) return undefined;

  try {
    const { id } = conversation;
    check?.();
    await (check ? groups.editAttributes(id, build) : groups.modifyGroup(id, build));
    return true as const;
  } catch (err) {
    reportError(err);
    return undefined;
  }
}

async function getGroupConversation(chat: Pick<ApiChat, 'id'>) {
  const conversation = await getConversationByPeerId(chat.id);
  return conversation?.type === 'group' ? conversation : undefined;
}

/** The ACIs behind user peers; users without a private conversation are skipped */
async function getAcis(users: Pick<ApiUser, 'id'>[]) {
  const conversations = await Promise.all(users.map(({ id }) => getConversationByPeerId(id)));
  return conversations
    .filter((conversation) => conversation?.type === 'private')
    .map((conversation) => conversation!.id);
}

/** The group link as the permanent invite of the chat; Signal does not record when it was made */
async function buildApiInvite(conversation: ConversationRecord): Promise<ApiExportedInvite | undefined> {
  const link = getGroupInviteLink(conversation);
  const selfAci = getCurrentAccount()?.aci;
  if (!link || !selfAci) return undefined;
  const { accessControl, requestingMembers } = conversation.groupState!;
  return {
    link,
    isPermanent: true,
    isRequestNeeded: accessControl.addFromInviteLink === AccessControl_AccessRequired.ADMINISTRATOR || undefined,
    requested: requestingMembers.length || undefined,
    date: 0,
    adminId: await getUserPeerId(selfAci),
  };
}

/**
 * Refused changes explain why, a refused link shows as expired, and other failures show a generic group error.
 * Edits that went as one change share their failure, which is shown once.
 */
function reportError(err: unknown, forbiddenKey = GROUP_CHANGE_ERROR) {
  if (err instanceof Error) {
    if (reportedErrors.has(err)) return;
    reportedErrors.add(err);
  }
  logError(err);
  const isForbidden = err instanceof GroupRequestError
    && (err.status === HTTP_FORBIDDEN || err.status === HTTP_NOT_FOUND);
  const message = err instanceof GroupChangeRefusedError
    ? REFUSED_CHANGE_ERRORS[err.reason]
    : isForbidden ? forbiddenKey : GROUP_CHANGE_ERROR;
  sendApiUpdate({ '@type': 'error', error: { message, hasErrorKey: true } });
}
