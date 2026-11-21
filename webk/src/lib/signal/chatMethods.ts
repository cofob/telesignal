/*
 * TeleSignal: the chat list methods of Web K (pins, archive, mute, unread marks, deleting chats), blocking, the
 * message requests and the blocked list, answered by the Signal provider in Telegram's shapes.
 */

import type {Chat, InputPeer, Update, User} from '@layer';
import type {SignalMethodHandlers, SignalMethodHost} from '@lib/signal/methodHost';
import {buildPeer, isGroupPeerId, toSignalPeerId} from '@lib/signal/builders';
import {unwrapInputPeer} from '@lib/signal/methodHost';
import makeError from '@helpers/makeError';
import tsNow from '@helpers/tsNow';

// * the error of a pin refused by the list's limit, as Web K shows it (`READABLE_ERROR_KEYS` of Web K)
const PINNED_LIMIT_ERROR = 'PINNED_DIALOGS_TOO_MUCH';

export function buildChatMethodHandlers(host: SignalMethodHost): SignalMethodHandlers {
  return {
    'messages.toggleDialogPin': ({peer, pinned}) => toggleDialogPin(host, unwrapInputPeer(peer), !!pinned),
    'folders.editPeerFolders': ({folder_peers}) => editPeerFolders(host, folder_peers),
    'account.updateNotifySettings': ({peer, settings}) => updateNotifySettings(host, peer, settings),
    'messages.markDialogUnread': ({peer, unread}) => markDialogUnread(host, unwrapInputPeer(peer), !!unread),
    'messages.deleteHistory': ({peer}) => deleteHistory(host, unwrapInputPeer(peer)),
    'contacts.block': ({id}) => setBlocked(host, id, true),
    'contacts.unblock': ({id}) => setBlocked(host, id, false),
    'contacts.getBlocked': ({offset, limit}) => getBlocked(host, offset, limit),
    'messages.getPeerSettings': ({peer}) => getPeerSettings(host, peer),
    'messages.hidePeerSettingsBar': ({peer}) => hidePeerSettingsBar(host, peer)
  };
}

/** The provider's chat of a Web K input peer, which the provider reads by its id */
export function getSignalChatOf(host: SignalMethodHost, inputPeer: InputPeer) {
  const peerId = host.getInputPeerId(inputPeer);
  return peerId === undefined ? undefined : {id: toSignalPeerId(peerId)};
}

async function toggleDialogPin(host: SignalMethodHost, peer: InputPeer, shouldBePinned: boolean) {
  const chat = getSignalChatOf(host, peer);
  if(!chat) return false;

  // * the provider answers `true` once the pin is saved, and nothing when the list's limit refuses it
  const isApplied = await host.call('toggleChatPinned', {chat, shouldBePinned});
  if(shouldBePinned && !isApplied) throw makeError(PINNED_LIMIT_ERROR as ErrorType);
  return true;
}

/** Archiving unpins the chat, which the provider does; the folder update tells Web K where the chat is now */
async function editPeerFolders(host: SignalMethodHost, folderPeers: {peer: InputPeer, folder_id: number}[]) {
  const folderPeerUpdates: {_: 'folderPeer', peer: ReturnType<typeof buildPeer>, folder_id: number}[] = [];
  for(const {peer, folder_id} of folderPeers) {
    const chat = getSignalChatOf(host, peer);
    if(!chat) continue;

    await host.call('toggleChatArchived', {chat, folderId: folder_id});
    folderPeerUpdates.push({_: 'folderPeer', peer: buildPeer(chat.id), folder_id});
  }

  return {
    _: 'updates',
    updates: folderPeerUpdates.length ? [{_: 'updateFolderPeers', folder_peers: folderPeerUpdates, pts: 0, pts_count: 0} as Update] : [],
    users: [] as User[],
    chats: [] as Chat[],
    date: tsNow(true),
    seq: 0
  };
}

/** Only the mute of a chat is kept by Signal; the sound and preview settings of this device are not */
async function updateNotifySettings(host: SignalMethodHost, peer: any, settings: {mute_until?: number}) {
  const chat = peer?._ === 'inputNotifyPeer' ? getSignalChatOf(host, peer.peer) : undefined;
  if(chat && 'mute_until' in settings) {
    await host.call('updateChatNotifySettings', {chat, settings: {mutedUntil: settings.mute_until || undefined}});
  }
  return true;
}

async function markDialogUnread(host: SignalMethodHost, peer: InputPeer, unread: boolean) {
  const chat = getSignalChatOf(host, peer);
  if(chat) {
    await host.call('toggleDialogUnread', {chat, hasUnreadMark: unread || undefined});
  }
  return true;
}

/**
 * Deletes the chat from this device and our other devices. Signal has no partial clearing of a chat, so Web K's
 * "Clear history" is not offered for Signal chats; a deletion removes the chat from the list as well.
 */
async function deleteHistory(host: SignalMethodHost, peer: InputPeer) {
  const chat = getSignalChatOf(host, peer);
  if(chat) {
    await host.call('deleteHistory', {chat});
  }
  return {_: 'messages.affectedHistory', pts: 0, pts_count: 0, offset: 0};
}

async function setBlocked(host: SignalMethodHost, id: InputPeer, isBlocked: boolean) {
  const chat = getSignalChatOf(host, id);
  if(!chat) return false;

  // * the provider's block answers the message request too, and its users come back as updates first
  const isApplied = await host.call(isBlocked ? 'blockUser' : 'unblockUser', {user: chat});
  return isApplied ? true : false;
}

/**
 * A page of the blocked contacts and groups (a limit of 0 is the whole list); their users and chats come as updates,
 * which Web K saves before the page
 */
async function getBlocked(host: SignalMethodHost, offset = 0, limit = 0) {
  const result: {blockedIds: string[], totalCount: number} | undefined = await host.call('fetchBlockedUsers', {});
  const blockedIds = (result?.blockedIds ?? []).slice(offset, limit ? offset + limit : undefined);
  return {
    _: 'contacts.blockedSlice',
    count: result?.totalCount ?? 0,
    blocked: blockedIds.map((id) => ({_: 'peerBlocked', peer_id: buildPeer(id), date: 0})),
    chats: [] as Chat[],
    users: [] as User[]
  };
}

/**
 * A message request of a chat with a person shows the bar with blocking; Signal's answer to a request from a person
 * is accepting it, closing the bar, or deleting the chat. A request from a group offers reporting it, which leaves
 * the group as well.
 */
async function getPeerSettings(host: SignalMethodHost, peer: InputPeer) {
  const chat = getSignalChatOf(host, peer);
  const result: {settings: {isMessageRequest?: boolean, canBlockContact?: boolean, canReportSpam?: boolean}} | undefined = (
    chat && await host.call('fetchPeerSettings', chat)
  );
  const settings = result?.settings;
  const isGroup = chat ? isGroupPeerId(chat.id) : false;
  return {
    _: 'messages.peerSettings',
    settings: {
      _: 'peerSettings',
      pFlags: {
        report_spam: (isGroup && settings?.canReportSpam) || undefined,
        block_contact: settings?.canBlockContact || undefined
      }
    },
    chats: [] as Chat[],
    users: [] as User[]
  };
}

/** Closing the bar of a message request accepts the request, as the provider does */
async function hidePeerSettingsBar(host: SignalMethodHost, peer: InputPeer) {
  const chat = getSignalChatOf(host, peer);
  if(chat) {
    await host.call('hidePeerSettingsBar', chat);
  }
  return true;
}
