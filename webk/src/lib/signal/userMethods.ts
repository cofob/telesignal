/*
 * TeleSignal: the user methods of Web K (a user's full profile, contacts search, finding users by username or phone
 * number, and the groups in common), answered by the Signal provider in Telegram's shapes.
 */

import type {Chat, InputUser, Peer, User} from '@layer';
import type {SignalMethodHandlers, SignalMethodHost} from '@lib/signal/methodHost';
import type {SignalChatStyle} from '@lib/signal/signalApi';
import {buildPeer, buildUser, toPeerId} from '@lib/signal/builders';
import {getInputUserPeerId, getUserRef} from '@lib/signal/methodHost';
import {SIGNAL_USERNAME_PATTERN} from '@lib/signal/usernames';
import makeError from '@helpers/makeError';

/** The safety number with a user and whether it is verified, for the safety number popup of Web K */
export function fetchSafetyNumber(host: SignalMethodHost, userId: PeerId) {
  return host.call<{digits: string, qrData?: string, isVerified: boolean} | undefined>('fetchSafetyNumber', {user: getUserRef(userId)});
}

export function updateSafetyNumberVerified(host: SignalMethodHost, userId: PeerId, isVerified: boolean) {
  return host.call('updateSafetyNumberVerified', {user: getUserRef(userId), isVerified});
}

export function buildUserMethodHandlers(host: SignalMethodHost): SignalMethodHandlers {
  return {
    'users.getFullUser': ({id}) => getFullUser(host, id),
    'contacts.search': ({q}) => searchContacts(host, q),
    'contacts.resolveUsername': ({username}) => resolveUsername(host, username),
    'contacts.resolvePhone': ({phone}) => resolvePhone(host, phone),
    'messages.getCommonChats': ({user_id}) => getCommonChats(host, user_id)
  };
}

async function getFullUser(host: SignalMethodHost, inputUser: InputUser) {
  const peerId = getInputUserPeerId(host, inputUser);
  const result: {
    user: any,
    fullInfo: {bio?: string, isBlocked?: boolean, ttlPeriod?: number, commonChatsCount?: number, signalChatStyle?: SignalChatStyle}
  } | undefined = (
    peerId !== undefined ? await host.call('fetchFullUser', getUserRef(peerId)) : undefined
  );
  if(!result) throw makeError('USER_ID_INVALID' as ErrorType);

  return {
    _: 'users.userFull',
    full_user: {
      _: 'userFull',
      pFlags: {
        blocked: result.fullInfo.isBlocked || undefined
      },
      id: peerId,
      about: result.fullInfo.bio,
      settings: {_: 'peerSettings', pFlags: {}},
      notify_settings: {_: 'peerNotifySettings'},
      common_chats_count: result.fullInfo.commonChatsCount ?? 0,
      ttl_period: result.fullInfo.ttlPeriod,
      // * not a field of Telegram's: the profile shows it (`PeerProfile.ChatStyle`)
      signal_chat_style: result.fullInfo.signalChatStyle
    },
    chats: [] as Chat[],
    users: [buildUser(result.user)] as User[]
  };
}

/** Our chats and contacts that match the query, which the provider sends as users and chats first */
async function searchContacts(host: SignalMethodHost, query: string) {
  const result: {accountResultIds: string[]} | undefined = await host.call('searchChats', {query});
  return {
    _: 'contacts.found',
    my_results: (result?.accountResultIds ?? []).map((id) => buildPeer(id)),
    results: [] as Peer[],
    chats: [] as Chat[],
    users: [] as User[]
  };
}

/**
 * Finds the Signal user of a username. Web K also resolves Telegram names on its own, such as `gif` or a bot's: they
 * have no discriminator, so the server is not asked, and only a user's click on a username row or link looks one up.
 */
async function resolveUsername(host: SignalMethodHost, username: string) {
  if(!SIGNAL_USERNAME_PATTERN.test(username)) throw makeError('USERNAME_NOT_OCCUPIED' as ErrorType);

  const result: {user?: any, error?: string} | undefined = await host.call('getChatByUsername', username);
  if(!result?.user) {
    throw makeError((result?.error === 'unavailable' ? 'USERNAME_INVALID' : 'USERNAME_NOT_OCCUPIED') as ErrorType);
  }
  return resolvedPeer(result.user);
}

async function resolvePhone(host: SignalMethodHost, phone: string) {
  const result: {user?: any, error?: string} | undefined = await host.call('lookUpPhoneNumber', phone);
  if(!result?.user) {
    throw makeError((result?.error === 'rateLimited' ? 'FLOOD_WAIT' : 'PHONE_NOT_OCCUPIED') as ErrorType);
  }
  return resolvedPeer(result.user);
}

function resolvedPeer(user: any) {
  return {
    _: 'contacts.resolvedPeer',
    peer: buildPeer(user.id),
    chats: [] as Chat[],
    users: [buildUser(user)] as User[]
  };
}

/** The groups we share with the user, which the provider sends as chats first */
async function getCommonChats(host: SignalMethodHost, inputUser: InputUser) {
  const peerId = getInputUserPeerId(host, inputUser);
  const result: {chatIds: string[]} | undefined = peerId !== undefined
    ? await host.call('fetchCommonChats', {user: getUserRef(peerId)})
    : undefined;
  const appChatsManager = host.getManagers().appChatsManager;
  const chats = (result?.chatIds ?? [])
  .map((id) => appChatsManager.getChat(-toPeerId(id) as ChatId))
  .filter(Boolean);
  return {_: 'messages.chats', chats};
}
