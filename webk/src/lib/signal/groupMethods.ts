/*
 * TeleSignal: the group methods of Web K (creating, members and their admins, the title, description, avatar and
 * permissions of a group, its invite link and join requests, disappearing messages and leaving), answered by the
 * Signal provider in Telegram's shapes. The changes come back as the provider's updates of the group.
 */

import type {Chat, ChatBannedRights, InputFile, MissingInvitee, Update, Updates, User} from '@layer';
import type {SignalMethodHandlers, SignalMethodHost} from '@lib/signal/methodHost';
import type {SignalPendingInvite} from '@lib/signal/signalApi';
import {getInputUserPeerId, getUserRef} from '@lib/signal/methodHost';
import {buildChat, toPeerId, toSignalPeerId} from '@lib/signal/builders';
import {getSignalChatOf} from '@lib/signal/chatMethods';
import {unwrapInputPeer} from '@lib/signal/methodHost';
import {makeReportedError} from '@lib/signal/errors';
import {takeUpload} from '@lib/signal/outgoingMedia';
import makeError from '@helpers/makeError';
import tsNow from '@helpers/tsNow';

// * the banned rights of Web K that Signal's group settings have (`updateChatDefaultBannedRights` of the provider)
const BANNED_RIGHTS_BY_FLAG: Record<string, string> = {
  send_plain: 'sendMessages',
  change_info: 'changeInfo',
  invite_users: 'inviteUsers',
  edit_rank: 'editRank'
};

// * the error of a group change the provider refused (`GROUP_CHANGE_ERROR` of `src/api/signal/methods/groups.ts`)
const GROUP_CHANGE_ERROR = 'SIGNAL_GROUP_CHANGE_FAILED';

// * the largest upload the group server takes for an avatar (signalapp/storage-service
// * `src/main/java/org/signal/storageservice/controllers/GroupsController.java`, `getAvatarUploadForm`); Signal Desktop
// * and Android set no lower limit for group avatars
const GROUP_AVATAR_MAX_SIZE = 3 * 1024 * 1024;
const AVATAR_TOO_BIG_ERROR = 'PHOTO_FILE_TOO_BIG';
const AVATAR_PARTS_ERROR = 'FILE_PARTS_INVALID';
const AVATAR_MIME_TYPE = 'image/jpeg';

export function buildGroupMethodHandlers(host: SignalMethodHost): SignalMethodHandlers {
  return {
    'messages.getFullChat': ({chat_id}) => getFullChat(host, chat_id),
    'messages.createChat': ({title, users}) => createChat(host, title, users),
    'messages.addChatUser': ({chat_id, user_id}) => addChatUser(host, chat_id, user_id),
    'messages.deleteChatUser': ({chat_id, user_id}) => deleteChatUser(host, chat_id, user_id),
    'messages.editChatAdmin': ({chat_id, user_id, is_admin}) => editChatAdmin(host, chat_id, user_id, is_admin),
    'messages.editChatTitle': ({chat_id, title}) => editChatTitle(host, chat_id, title),
    'messages.editChatAbout': ({peer, about}) => editChatAbout(host, peer, about),
    'messages.editChatPhoto': ({chat_id, photo}) => editChatPhoto(host, chat_id, photo),
    'messages.editChatDefaultBannedRights': ({peer, banned_rights}) => editChatDefaultBannedRights(host, peer, banned_rights),
    'messages.editChatParticipantRank': ({peer, participant, rank}) => editChatParticipantRank(host, peer, participant, rank),
    'messages.exportChatInvite': ({peer, request_needed}) => exportChatInvite(host, peer, request_needed),
    'messages.getExportedChatInvites': ({peer, revoked}) => getExportedChatInvites(host, peer, revoked),
    'messages.editExportedChatInvite': ({peer, link, revoked, request_needed}) => (
      editExportedChatInvite(host, peer, link, revoked, request_needed)
    ),
    'messages.deleteExportedChatInvite': ({peer}) => disableChatInvite(host, peer),
    'messages.getChatInviteImporters': ({peer, requested}) => getChatInviteImporters(host, peer, requested),
    'messages.hideChatJoinRequest': ({peer, user_id, approved}) => hideChatJoinRequest(host, peer, user_id, approved),
    'messages.hideAllChatJoinRequests': ({peer, approved}) => hideAllChatJoinRequests(host, peer, approved),
    'messages.checkChatInvite': ({hash}) => checkChatInvite(host, hash),
    'messages.importChatInvite': ({hash}) => importChatInvite(host, hash),
    'messages.setHistoryTTL': ({peer, period}) => setHistoryTtl(host, peer, period)
  };
}

/**
 * Waits for a change of a group or of a chat's timer and rejects when the provider refused it: it answers `undefined`
 * only after reporting the reason as an error update, which Web K shows
 */
async function applyGroupChange(promise: Promise<unknown>) {
  if(await promise === undefined) throw makeReportedError(GROUP_CHANGE_ERROR);
}

/** The result of a change of a group: the provider's update of the group comes separately */
function emptyUpdates(): Updates {
  return {_: 'updates', updates: [] as Update[], users: [] as User[], chats: [] as Chat[], date: tsNow(true), seq: 0};
}

/** The provider's chat of a group of Web K (`chat_id`, which is the negated peer id of the group) */
function getGroupOf(host: SignalMethodHost, chatId: number) {
  return getSignalChatOf(host, {_: 'inputPeerChat', chat_id: chatId});
}

/**
 * The members of a group with their admin roles and tags (a basic group's tags live in its full chat), its
 * description, and its invite link while it is on
 */
async function getFullChat(host: SignalMethodHost, chatId: number) {
  const chat = getGroupOf(host, chatId);
  const result: {fullInfo: any, users: User[]} | undefined = await host.call('fetchFullChat', chat);
  const fullInfo = result?.fullInfo;
  const participants = (fullInfo?.members ?? []).map(({userId, rank, isAdmin}: {userId: string, rank?: string, isAdmin?: boolean}) => ({
    ...(isAdmin ? {_: 'chatParticipantAdmin', inviter_id: 0, date: 0} : {_: 'chatParticipant', inviter_id: 0, date: 0}),
    user_id: toPeerId(userId),
    rank: rank || undefined
  }));
  const inviteLink: string | undefined = fullInfo?.inviteLink;
  return {
    _: 'messages.chatFull',
    full_chat: {
      _: 'chatFull',
      pFlags: {},
      id: chatId,
      about: fullInfo?.about ?? '',
      participants: {_: 'chatParticipants', chat_id: chatId, participants, version: 0},
      notify_settings: {_: 'peerNotifySettings'},
      exported_invite: inviteLink ? {_: 'chatInviteExported', pFlags: {permanent: true}, link: inviteLink, admin_id: 0, date: 0} : undefined,
      ttl_period: fullInfo?.ttlPeriod || undefined,
      // * the join requests of the group link, which only admins get
      requests_pending: fullInfo?.requestsPending,
      recent_requesters: fullInfo?.recentRequesterIds?.map((id: string) => toPeerId(id)),
      // * not fields of Telegram's: the profile shows the colours (`PeerProfile.ChatStyle`), group management the
      // * invitations not yet accepted (`sidebarRight/tabs/pendingInvites`)
      signal_chat_style: fullInfo?.signalChatStyle,
      signal_pending_invites: (fullInfo?.pendingInvites ?? []).map((invite: {
        serviceId: string, userId?: string, phoneNumber?: string, inviterId?: string
      }): SignalPendingInvite => ({
        serviceId: invite.serviceId,
        userId: invite.userId ? toPeerId(invite.userId) : undefined,
        phoneNumber: invite.phoneNumber,
        inviterId: invite.inviterId ? toPeerId(invite.inviterId) : undefined
      }))
    },
    chats: [] as Chat[],
    users: result?.users ?? []
  };
}

async function createChat(host: SignalMethodHost, title: string, users: any[]) {
  const peerIds = users.map((user) => getInputUserPeerId(host, user)).filter(Boolean);
  const result: {chat: any} | undefined = await host.call('createGroupChat', {
    title,
    users: peerIds.map((peerId) => ({id: toSignalPeerId(peerId)}))
  });
  if(!result?.chat) throw makeReportedError(GROUP_CHANGE_ERROR);

  const chat = buildChat(result.chat);
  return {
    _: 'messages.invitedUsers',
    updates: {_: 'updates', updates: [] as Update[], users: [] as User[], chats: [chat], date: tsNow(true), seq: 0},
    missing_invitees: [] as MissingInvitee[]
  };
}

/** Adding ourselves is joining the group, which accepts our invitation (Web A's `joinChannel` action) */
async function addChatUser(host: SignalMethodHost, chatId: number, inputUser: any) {
  const peerId = getInputUserPeerId(host, inputUser);
  const chat = getGroupOf(host, chatId);
  if(peerId === undefined || !chat) throw makeError(GROUP_CHANGE_ERROR as ErrorType);

  await applyGroupChange(peerId === host.getManagers().appPeersManager.peerId ?
    host.call('joinChannel', {channelId: chat.id, accessHash: ''}) :
    host.call('addChatMembers', chat, [getUserRef(peerId)]));
  return {_: 'messages.invitedUsers', updates: emptyUpdates(), missing_invitees: [] as MissingInvitee[]};
}

/** Leaving the group is removing ourselves from it; removing someone else bans them, as Signal does */
async function deleteChatUser(host: SignalMethodHost, chatId: number, inputUser: any) {
  const peerId = getInputUserPeerId(host, inputUser);
  const chat = getGroupOf(host, chatId);
  if(peerId === undefined || !chat) throw makeError(GROUP_CHANGE_ERROR as ErrorType);

  const isSelf = peerId === host.getManagers().appPeersManager.peerId;
  await applyGroupChange(host.call('deleteChatUser', {chat, user: {...getUserRef(peerId), isSelf}}));
  return emptyUpdates();
}

async function editChatAdmin(host: SignalMethodHost, chatId: number, inputUser: any, isAdmin: boolean) {
  const peerId = getInputUserPeerId(host, inputUser);
  const chat = getGroupOf(host, chatId);
  if(peerId === undefined || !chat) throw makeError(GROUP_CHANGE_ERROR as ErrorType);

  // * Signal's admins have every admin right; a member has none
  await applyGroupChange(host.call('updateChatAdmin', {
    chat, user: getUserRef(peerId), adminRights: isAdmin ? {changeInfo: true} : {}
  }));
  return true;
}

async function editChatTitle(host: SignalMethodHost, chatId: number, title: string) {
  const chat = getGroupOf(host, chatId);
  if(!chat) throw makeError(GROUP_CHANGE_ERROR as ErrorType);

  await applyGroupChange(host.call('updateChatTitle', chat, title));
  return emptyUpdates();
}

async function editChatAbout(host: SignalMethodHost, peer: any, about: string) {
  const chat = getSignalChatOf(host, unwrapInputPeer(peer));
  if(!chat) throw makeError(GROUP_CHANGE_ERROR as ErrorType);

  await applyGroupChange(host.call('updateChatAbout', chat, about));
  return true;
}

/**
 * An avatar sent as an upload, whose parts are taken from the uploads of this session, or no avatar
 * (`inputChatPhotoEmpty`) to remove it
 */
async function editChatPhoto(host: SignalMethodHost, chatId: number, photo: any) {
  // * Signal keeps no earlier avatars to choose again
  if(photo?._ !== 'inputChatUploadedPhoto' && photo?._ !== 'inputChatPhotoEmpty') {
    throw makeError(AVATAR_PARTS_ERROR as ErrorType);
  }

  const file = photo._ === 'inputChatUploadedPhoto' ? takeUploadedFile(photo.file) : undefined;
  const chat = getGroupOf(host, chatId);
  if(!chat) throw makeError(GROUP_CHANGE_ERROR as ErrorType);

  const isApplied = await host.call('editChatPhoto', {chat, photo: file ? {file} : undefined});
  if(!isApplied) throw makeReportedError(GROUP_CHANGE_ERROR);
  return emptyUpdates();
}

/**
 * The uploaded avatar from the uploads of media (`outgoingMedia.ts`); an upload with missing parts, or over the group
 * server's limit, is refused
 */
function takeUploadedFile(inputFile: InputFile) {
  let blob: Blob, name: string;
  try {
    ({blob, name} = takeUpload(inputFile, AVATAR_MIME_TYPE));
  } catch(err) {
    throw makeError(AVATAR_PARTS_ERROR as ErrorType);
  }

  if(blob.size > GROUP_AVATAR_MAX_SIZE) throw makeError(AVATAR_TOO_BIG_ERROR as ErrorType);
  return new File([blob], name ?? 'avatar.jpg', {type: AVATAR_MIME_TYPE});
}

async function editChatDefaultBannedRights(host: SignalMethodHost, peer: any, bannedRights: ChatBannedRights.chatBannedRights) {
  const chat = getSignalChatOf(host, unwrapInputPeer(peer));
  if(!chat) throw makeError(GROUP_CHANGE_ERROR as ErrorType);

  const rights: Record<string, boolean> = {};
  Object.entries(BANNED_RIGHTS_BY_FLAG).forEach(([flag, name]) => {
    rights[name] = Boolean(bannedRights.pFlags[flag as keyof ChatBannedRights.chatBannedRights['pFlags']]);
  });
  await applyGroupChange(host.call('updateChatDefaultBannedRights', {chat, bannedRights: rights}));
  return emptyUpdates();
}

async function editChatParticipantRank(host: SignalMethodHost, peer: any, participant: any, rank: string) {
  const chat = getSignalChatOf(host, unwrapInputPeer(peer));
  const peerId = getInputUserPeerId(host, participant);
  if(!chat || peerId === undefined) throw makeError(GROUP_CHANGE_ERROR as ErrorType);

  await applyGroupChange(host.call('editChatParticipantRank', {chat, peer: getUserRef(peerId), rank}));
  return emptyUpdates();
}

// The invite link of a Signal group is the one link of the group; its shape follows Telegram's exported invite

function buildExportedInvite(invite: any) {
  return {
    _: 'chatInviteExported',
    pFlags: {
      permanent: invite.isPermanent || undefined,
      request_needed: invite.isRequestNeeded || undefined,
      revoked: invite.isRevoked || undefined
    },
    link: invite.link,
    admin_id: toPeerId(invite.adminId),
    date: invite.date,
    requested: invite.requested,
    usage: invite.usage,
    title: invite.title
  };
}

async function exportChatInvite(host: SignalMethodHost, peer: any, isRequestNeeded?: boolean) {
  const chat = getSignalChatOf(host, unwrapInputPeer(peer));
  const invite = chat && await host.call('exportChatInvite', {peer: chat, isRequestNeeded});
  if(!invite) throw makeReportedError(GROUP_CHANGE_ERROR);
  return buildExportedInvite(invite);
}

async function getExportedChatInvites(host: SignalMethodHost, peer: any, isRevoked?: boolean) {
  const chat = getSignalChatOf(host, unwrapInputPeer(peer));
  const result: {invites: any[]} | undefined = chat && await host.call('fetchExportedChatInvites', {peer: chat, isRevoked});
  const invites = (result?.invites ?? []).map(buildExportedInvite);
  return {_: 'messages.exportedChatInvites', count: invites.length, invites, users: [] as User[]};
}

async function editExportedChatInvite(host: SignalMethodHost, peer: any, link: string, isRevoked?: boolean, isRequestNeeded?: boolean) {
  const chat = getSignalChatOf(host, unwrapInputPeer(peer));
  const result: {oldInvite: any, newInvite: any} | undefined = chat && await host.call('editExportedChatInvite', {
    peer: chat, isRevoked, link, isRequestNeeded
  });
  if(!result) throw makeError('INVITE_HASH_EXPIRED' as ErrorType);

  if(isRevoked) {
    return {
      _: 'messages.exportedChatInviteReplaced',
      invite: buildExportedInvite(result.oldInvite),
      new_invite: buildExportedInvite(result.newInvite),
      users: [] as User[]
    };
  }
  return {_: 'messages.exportedChatInvite', invite: buildExportedInvite(result.newInvite), users: [] as User[]};
}

/** Signal keeps no revoked links: deleting the group's link turns it off, and turning it on brings it back */
async function disableChatInvite(host: SignalMethodHost, peer: any) {
  const chat = getSignalChatOf(host, unwrapInputPeer(peer));
  if(!chat) throw makeError(GROUP_CHANGE_ERROR as ErrorType);

  await applyGroupChange(host.call('disableChatInvite', {peer: chat}));
  return true;
}

async function getChatInviteImporters(host: SignalMethodHost, peer: any, isRequested?: boolean) {
  const chat = getSignalChatOf(host, unwrapInputPeer(peer));
  const result: {importers: {userId: string, date: number, isRequested?: boolean}[]} | undefined = chat && await host.call(
    'fetchChatInviteImporters', {peer: chat, isRequested}
  );
  const importers = (result?.importers ?? []).map(({userId, date}) => ({
    _: 'chatInviteImporter',
    pFlags: {requested: true},
    user_id: toPeerId(userId),
    date
  }));
  return {_: 'messages.chatInviteImporters', count: importers.length, importers, users: [] as User[]};
}

async function hideChatJoinRequest(host: SignalMethodHost, peer: any, inputUser: any, isApproved: boolean) {
  const chat = getSignalChatOf(host, unwrapInputPeer(peer));
  const peerId = getInputUserPeerId(host, inputUser);
  if(!chat || peerId === undefined) throw makeError(GROUP_CHANGE_ERROR as ErrorType);

  await applyGroupChange(host.call('hideChatJoinRequest', {peer: chat, user: getUserRef(peerId), isApproved}));
  return emptyUpdates();
}

async function hideAllChatJoinRequests(host: SignalMethodHost, peer: any, isApproved: boolean) {
  const chat = getSignalChatOf(host, unwrapInputPeer(peer));
  if(!chat) throw makeError(GROUP_CHANGE_ERROR as ErrorType);

  // * the provider answers `true` when no request is left, as for the requests it answered
  await applyGroupChange(host.call('hideAllChatJoinRequests', {peer: chat, isApproved}));
  return emptyUpdates();
}

/** A link to a group: the group itself when we are in it, or what the link shows before joining */
async function checkChatInvite(host: SignalMethodHost, hash: string) {
  const result: {chat?: any, invite?: any} | undefined = await host.call('checkChatInvite', hash);
  if(result?.chat) {
    return {_: 'messages.chatInviteAlready', chat: buildChat(result.chat), users: [] as User[]};
  }

  const invite = result?.invite;
  if(!invite) throw makeError('INVITE_HASH_EXPIRED' as ErrorType);
  return {
    _: 'chatInvite',
    pFlags: {request_needed: invite.isRequestNeeded || undefined},
    title: invite.title,
    about: invite.about,
    photo: {_: 'photoEmpty', id: '0'},
    participants_count: invite.participantsCount,
    color: invite.color ?? 0
  };
}

/** Joins through a link; a link that needs approval sends a request, which has no group yet */
async function importChatInvite(host: SignalMethodHost, hash: string) {
  const result: {type: 'ok', chat: any} | {type: 'requested'} | undefined = await host.call('importChatInvite', {hash});
  if(!result) throw makeError('INVITE_HASH_EXPIRED' as ErrorType);
  if(result.type === 'requested') throw makeError('INVITE_REQUEST_SENT' as ErrorType);

  return {
    _: 'messages.chatInviteJoinResult',
    updates: {_: 'updates', updates: [] as Update[], users: [] as User[], chats: [buildChat(result.chat)] as Chat[], date: tsNow(true), seq: 0}
  };
}

/** The disappearing messages timer of a chat: a group's is part of its state, a private chat's is sent to them */
async function setHistoryTtl(host: SignalMethodHost, peer: any, period: number) {
  const chat = getSignalChatOf(host, unwrapInputPeer(peer));
  if(!chat) throw makeError(GROUP_CHANGE_ERROR as ErrorType);

  await applyGroupChange(host.call('setHistoryTtl', {peer: chat, period}));
  return emptyUpdates();
}
