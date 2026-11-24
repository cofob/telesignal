/*
 * TeleSignal: the chat list methods of Web K (pins, archive, mute, unread marks, deleting chats), blocking, the
 * message requests and the blocked list, answered by the Signal provider in Telegram's shapes.
 */

import type {Chat, InputPeer, Update, User} from '@layer';
import type {SignalMethodHandlers, SignalMethodHost} from '@lib/signal/methodHost';
import {buildPeer, toSignalPeerId} from '@lib/signal/builders';
import {unwrapInputPeer} from '@lib/signal/methodHost';
import {makeReportedError} from '@lib/signal/errors';
import makeError from '@helpers/makeError';
import tsNow from '@helpers/tsNow';

// * the error of a pin refused by the list's limit, as Web K shows it (`READABLE_ERROR_KEYS` of Web K)
const PINNED_LIMIT_ERROR = 'PINNED_DIALOGS_TOO_MUCH';
// * the error of an answer to a message request that did not go out
const REQUEST_RESPONSE_ERROR = 'SIGNAL_REQUEST_RESPONSE_FAILED';
// * the error of a chat change the provider refused (`CHAT_CHANGE_ERROR` of `src/api/signal/methods/chats.ts`)
const CHAT_CHANGE_ERROR = 'SIGNAL_CHAT_CHANGE_FAILED';
// * the error of a request that Signal cannot honour, as the adapter answers methods it lacks
const UNSUPPORTED_ERROR = 'SIGNAL_METHOD_UNSUPPORTED';

export function buildChatMethodHandlers(host: SignalMethodHost): SignalMethodHandlers {
  return {
    'messages.toggleDialogPin': ({peer, pinned}) => toggleDialogPin(host, unwrapInputPeer(peer), !!pinned),
    'folders.editPeerFolders': ({folder_peers}) => editPeerFolders(host, folder_peers),
    'account.updateNotifySettings': ({peer, settings}) => updateNotifySettings(host, peer, settings),
    'messages.markDialogUnread': ({peer, unread}) => markDialogUnread(host, unwrapInputPeer(peer), !!unread),
    'messages.deleteHistory': ({peer, just_clear, min_date, max_date}) => (
      deleteHistory(host, unwrapInputPeer(peer), !!just_clear || min_date !== undefined || max_date !== undefined)
    ),
    'contacts.block': ({id}) => setBlocked(host, id, true),
    'contacts.unblock': ({id}) => setBlocked(host, id, false),
    'contacts.getBlocked': ({offset, limit}) => getBlocked(host, offset, limit),
    'messages.getPeerSettings': ({peer}) => getPeerSettings(host, peer),
    'messages.hidePeerSettingsBar': ({peer}) => hidePeerSettingsBar(host, peer),
    'messages.reportSpam': ({peer}) => reportSpam(host, peer)
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
 * Deletes the chat from this device and our other devices. Signal has no partial clearing of a chat, so a request
 * to keep the chat (`just_clear`) or to delete a date range is refused instead of deleting the whole chat.
 */
async function deleteHistory(host: SignalMethodHost, peer: InputPeer, isPartial: boolean) {
  if(isPartial) throw makeError(UNSUPPORTED_ERROR as ErrorType);

  const chat = getSignalChatOf(host, peer);
  if(!chat) throw makeError(UNSUPPORTED_ERROR as ErrorType);

  // * a failed deletion was reported by the provider, and the chat stays
  if(!await host.call('deleteHistory', {chat})) throw makeReportedError(CHAT_CHANGE_ERROR);
  return {_: 'messages.affectedHistory', pts: 0, pts_count: 0, offset: 0};
}

async function setBlocked(host: SignalMethodHost, id: InputPeer, isBlocked: boolean) {
  const chat = getSignalChatOf(host, id);
  // * the provider's block answers the message request too, and its users come back as updates first
  const isApplied = chat && await host.call(isBlocked ? 'blockUser' : 'unblockUser', {user: chat});
  if(!isApplied) throw makeError(REQUEST_RESPONSE_ERROR as ErrorType);
  return true;
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
 * A message request of a person or a group, which Web K marks with `block_contact`: the chat's bar then offers
 * Signal's answers to it (`components/chat/actions.tsx`)
 */
async function getPeerSettings(host: SignalMethodHost, peer: InputPeer) {
  const chat = getSignalChatOf(host, peer);
  const result: {settings: {isMessageRequest?: boolean}} | undefined = chat && await host.call('fetchPeerSettings', chat);
  return {
    _: 'messages.peerSettings',
    settings: {
      _: 'peerSettings',
      pFlags: {
        block_contact: result?.settings.isMessageRequest || undefined
      }
    },
    chats: [] as Chat[],
    users: [] as User[]
  };
}

/**
 * Accepts a message request, as the provider's `hidePeerSettingsBar` does: our profile key, read receipts and typing
 * go to the chat from then on. The close button of Web K's bar only hides it on this tab (`chat/actions.tsx`).
 */
async function hidePeerSettingsBar(host: SignalMethodHost, peer: InputPeer) {
  const chat = getSignalChatOf(host, peer);
  const isApplied = chat && await host.call('hidePeerSettingsBar', chat);
  if(!isApplied) throw makeError(REQUEST_RESPONSE_ERROR as ErrorType);
  return true;
}

/** Reports a message request as spam, which Signal answers for the chat on our other devices as well */
async function reportSpam(host: SignalMethodHost, peer: InputPeer) {
  const chat = getSignalChatOf(host, peer);
  const isApplied = chat && await host.call('reportSpam', chat);
  if(!isApplied) throw makeError(REQUEST_RESPONSE_ERROR as ErrorType);
  return true;
}
